// `spyOn(process, "exit")`, `spyOn(globalThis, "fetch")`, `Object.defineProperty(process, "platform", ..)`, `Object.assign(globalThis, { .. })`: what tests do all day. The object was an operand of a
// call, so it counted as handed on; `process`, the global object and `Bun` lead to loaders; so the file "hands on a module that it does not spell", and the whole run is compiled for loads under any name.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const made = `["node", "os"].join(":")`;
const uses: Record<string, { text: string; handsOn: boolean; seen?: string }> = {
  "a spy on process": {
    text: `spyOn(process, "cwd").mockReturnValue("spied"); say(process.cwd());`,
    handsOn: false,
    seen: "spied",
  },
  "a spy on the global object": {
    text: `spyOn(globalThis, "fetch").mockReturnValue("spied"); say(fetch("x"));`,
    handsOn: false,
    seen: "spied",
  },
  "a spy on Bun": {
    text: `spyOn(Bun, "which").mockReturnValue("spied"); say(Bun.which("x"));`,
    handsOn: false,
    seen: "spied",
  },
  "a definition on process": {
    text: `Object.defineProperty(process, "platform", { value: "never" }); say(process.platform);`,
    handsOn: false,
    seen: "never",
  },
  "members assigned to the global object": {
    text: `Object.assign(globalThis, { added: "added" }); say(added);`,
    handsOn: false,
    seen: "added",
  },
  // `process` only leads to a loader, wherever it goes: an-object-that-only-leads-to-a-loader-hands-on-no-module.test.ts. What Bun itself holds is there for whoever asks the host.
  "process is the second operand": {
    text: `say(typeof Object.assign({}, process).getBuiltinModule.call(process, ${made}).EOL);`,
    handsOn: false,
    seen: "string",
  },
  "process goes to a function": {
    text: `const load = from => from.getBuiltinModule(${made}); say(typeof load(process).EOL);`,
    handsOn: false,
    seen: "string",
  },
  "process is kept in a list": {
    text: `say(typeof [process][0].getBuiltinModule(${made}).EOL);`,
    handsOn: false,
    seen: "string",
  },
  "the loader itself goes to a function": {
    text: `const load = by => by(${made}); say(typeof load(process.getBuiltinModule).EOL);`,
    handsOn: true,
    seen: "string",
  },
  // The guess is held at run time: whoever regains the object and loads under a name that nobody has read is refused, aloud.
  "process comes back out of the record of a spy": {
    text: `const spy = spyOn(process, "uptime"); process.uptime(); try { say(typeof spy.mock.contexts[0].getBuiltinModule(${made}).EOL); } catch (error) { say(error.message.slice(0, 24)); }`,
    handsOn: false,
    seen: "Cannot load 'node:os': i",
  },
};

for (const [name, { text, handsOn, seen }] of Object.entries(uses))
  test.concurrent(name, async () => {
    using dir = tempDir("aot-written-on", {
      "package.json": `{ "name": "p", "type": "module" }`,
      "a.test.js": `import { spyOn, test } from "bun:test";\nconst say = it => console.error("SEEN " + it);\ntest("t", () => { ${text} });\n`,
    });
    const env = { ...bunEnv, BUN_JSC_logAOTPhaseTimes: "1" };
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--aot"], String(dir), env);
    const lines = (stdout + "\n" + stderr).split("\n");
    expect({
      seen: lines.filter(line => line.startsWith("SEEN ")),
      handsOn: [...new Set(lines.flatMap(line => /\| hands on any module (true|false) \|/.exec(line)?.[1] ?? []))],
      exitCode,
    }).toEqual({ seen: ["SEEN " + seen], handsOn: [String(handsOn)], exitCode: 0 });
  });
