// `new Function(text)`, `(0, eval)(text)`, `vm.runInThisContext(text)` with a text that nobody knows: the text is GLOBAL code. It sees no name of the file that evaluates it. It gets the test runner through `Bun` or the
// global object, where what it calls refuses it aloud with what to write instead, or it is handed an object of the runner, which the build sees and which opens the run by itself.
// So such a file no longer leaves the whole run open to a spy under any name. A direct `eval` sees the `spyOn` that the file imports: it still does.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const refusal =
  /Cannot spy on 'half' of ".*math\.js" because the build didn't see a test spy on it\. Spell out the module and the name where the spy is made/;
const lay = `Bun.jest(path).spyOn(ns, "ha" + "lf").mockReturnValue("spied")`;
const ways: Record<string, { text: string; plain: string; anyName: boolean; isRefused?: true }> = {
  "new Function": {
    text: `say(new Function("x", made("return x + 1"))(1) + " " + read());`,
    plain: "2 2,4",
    anyName: false,
  },
  "Function without new": { text: `say(Function(made("return 2"))() + " " + read());`, plain: "2 2,4", anyName: false },
  "an indirect eval": { text: `say((0, eval)(made("1 + 1")) + " " + read());`, plain: "2 2,4", anyName: false },
  "eval off the global object": {
    text: `say(globalThis.eval(made("1 + 1")) + " " + read());`,
    plain: "2 2,4",
    anyName: false,
  },
  "eval under another name": {
    text: `const evaluate = eval; say(evaluate(made("1 + 1")) + " " + read());`,
    plain: "2 2,4",
    anyName: false,
  },
  "vm.runInThisContext": {
    text: `say(vm.runInThisContext(made("1 + 1")) + " " + read());`,
    plain: "2 2,4",
    anyName: false,
  },
  "vm.runInNewContext": {
    text: `say(vm.runInNewContext(made("n + 1"), { n: 1 }) + " " + read());`,
    plain: "2 2,4",
    anyName: false,
  },
  "vm.Script": {
    text: `say(new vm.Script(made("1 + 1")).runInThisContext() + " " + read());`,
    plain: "2 2,4",
    anyName: false,
  },
  // What still opens the run.
  "global code is handed spyOn": {
    text: `new Function("spy", "ns", made('spy(ns, "ha" + "lf").mockReturnValue("spied")'))(spyOn, math); say(read());`,
    plain: "spied,4",
    anyName: true,
  },
  "a direct eval": {
    text: `eval(made('spyOn(math, "ha" + "lf").mockReturnValue("spied")')); say(read());`,
    plain: "spied,4",
    anyName: true,
  },
  "new Function inside a direct eval": {
    text: `eval(made('new Function("spy", "ns", "spy(ns, \\\\"half\\\\").mockReturnValue(\\\\"spied\\\\")")(spyOn, math)')); say(read());`,
    plain: "spied,4",
    anyName: true,
  },
  // A text that the test file spells is read as code, whoever evaluates it. What `Bun.jest(path)` answers there is followed, so the spy is one under the name that the text spells.
  "a text that the file spells reaches the runner through Bun": {
    text: `new Function("ns", "path", made(${JSON.stringify(lay)}))(math, import.meta.path); say(read());`,
    plain: "spied,4",
    anyName: false,
  },
  // From an answer to a refusal: a text that no build has read reaches the runner through Bun.
  "new Function of a text from a file": {
    text: `new Function("ns", "path", fromFile())(math, import.meta.path); say(read());`,
    plain: "spied,4",
    anyName: false,
    isRefused: true,
  },
  "an indirect eval of a text from a file": {
    text: `globalThis.ns = math; globalThis.path = import.meta.path; (0, eval)(fromFile()); say(read());`,
    plain: "spied,4",
    anyName: false,
    isRefused: true,
  },
  "vm.runInThisContext of a text from a file": {
    text: `globalThis.ns = math; globalThis.path = import.meta.path; vm.runInThisContext(fromFile()); say(read());`,
    plain: "spied,4",
    anyName: false,
    isRefused: true,
  },
};

for (const [name, { text, plain, anyName, isRefused }] of Object.entries(ways))
  test.concurrent(name, async () => {
    using dir = tempDir("aot-global-code", {
      "package.json": `{ "name": "p", "type": "module" }`,
      "math.js": `export function half(n) { return n / 2; }\nexport function kept(n) { return n; }\n`,
      "reader.js": `import { half, kept } from "./math.js";\nexport const read = () => [half(4), kept(4)].join();\n`,
      "lay.txt": lay,
      "a.test.js": `import { spyOn, test } from "bun:test";\nimport { readFileSync } from "node:fs";\nimport vm from "node:vm";\nconst fromFile = () => readFileSync(import.meta.dir + "/lay.txt", "utf8");\nimport * as math from "./math.js";\nimport { read } from "./reader.js";\nconst made = text => text + " ".repeat(Math.floor(Math.random() * 0));\nconst say = it => console.error("SEEN " + it);\ntest("t", () => { ${text} });\n`,
    });
    const seenWith = async (...flags: string[]) => {
      const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), {
        ...bunEnv,
        BUN_JSC_logAOTPhaseTimes: "1",
      });
      const lines = (stdout + "\n" + stderr).split("\n");
      return {
        seen: lines.filter(line => line.startsWith("SEEN ")),
        isRefused: lines.some(line => refusal.test(line)),
        found: lines
          .flatMap(
            line =>
              /variables that tests may replace \d+ in .* a spy under any name (true|false)/.exec(line)?.slice(1, 2) ??
              [],
          )
          .slice(0, 1),
        exitCode,
      };
    };
    expect(await seenWith()).toEqual({ seen: ["SEEN " + plain], isRefused: false, found: [], exitCode: 0 });
    expect(await seenWith("--aot")).toEqual({
      seen: isRefused ? [] : ["SEEN " + plain],
      isRefused: isRefused === true,
      found: [String(anyName)],
      exitCode: isRefused ? 1 : 0,
    });
  });
