// `const put = object => { object.__mark = 1; }`, `put(Object.prototype)`: Object.prototype takes no name that the build has not seen a test add. Where a file of the tests lets such an
// object go, the build opens it for the names that the file itself, or a file that it imports, stores on an object from somewhere. It used to open every such object of the run for every
// such name of the run: on a suite of 3,000 test files four objects times 1,200 names, and each of them weakens every lookup under that name in the whole program.
// A store farther off is left to the engine, which follows the object where it can; where it cannot, the store is refused when it runs, aloud, with what to write instead.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const show = (name: string) => `say(String(({})["${name}"])); delete Object.prototype["${name}"];`;
const cases: Record<string, { files: Record<string, string>; body: string; plain: string; added: number }> = {
  "the file that lets the object go stores the name": {
    files: {},
    body: `const put = object => { object.__near = 1; }; put(Object.prototype); ${show("__near")}`,
    plain: "1",
    added: 1,
  },
  "a file that it imports stores the name": {
    files: { "put.js": `export const put = object => { object.__near = 1; };\n` },
    body: `const { put } = await import("./put.js"); put(Object.prototype); ${show("__near")}`,
    plain: "1",
    added: 1,
  },
  "places out of a list are marked under a constant name": {
    files: {},
    body: `const MARK = "__near"; const places = () => [["o", Object.prototype], ["f", Function.prototype]]; for (const [, place] of places()) Reflect.set(place, MARK, 1); delete Function.prototype[MARK]; ${show("__near")}`,
    plain: "1",
    added: 2,
  },
  "nothing is let go, and the names that are stored open nothing": {
    files: {},
    body: `const put = object => { object.__near = 1; return object; }; say(String(put({}).__near));`,
    plain: "1",
    added: 0,
  },
  // The front end lists nothing. The engine follows the object to the store by itself.
  "the name is stored by a file that nothing ties to the one that lets the object go": {
    files: {
      "b.test.js": `import { test } from "bun:test";\nglobalThis.putFar = object => { object.__far = 1; };\ntest("b", () => {});\n`,
    },
    body: `take(globalThis).putFar(Object.prototype); ${show("__far")}`,
    plain: "1",
    added: 0,
  },
};

for (const [name, { files, body, plain, added }] of Object.entries(cases))
  test.concurrent(name, async () => {
    using dir = tempDir("aot-names-beside-their-holders", {
      "package.json": `{ "name": "p", "type": "module" }`,
      ...files,
      "c.test.js": `import { test } from "bun:test";\nconst take = it => it;\nconst say = it => console.log("SEEN " + it);\ntest("c", async () => { ${body} });\n`,
    });
    const seenWith = async (...flags: string[]) => {
      const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), {
        ...bunEnv,
        BUN_JSC_logAOTPhaseTimes: "1",
      });
      const lines = (stdout + "\n" + stderr).split("\n");
      return {
        seen: lines.filter(line => line.startsWith("SEEN ")),
        added: lines.flatMap(line => /\| names added (\d+) \|/.exec(line)?.slice(1) ?? []).map(Number),
        exitCode,
      };
    };
    expect(await seenWith()).toEqual({ seen: ["SEEN " + plain], added: [], exitCode: 0 });
    expect(await seenWith("--aot")).toEqual({ seen: ["SEEN " + plain], added: [added], exitCode: 0 });
  });
