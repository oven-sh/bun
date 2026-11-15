// `helper(process)`, `delete globalThis.kept`, `"kept" in globalThis`, `pathsOf(import.meta)`: below each of these objects hangs something that loads a module under a name that it is given
// (process.getBuiltinModule, process.mainModule.require, import.meta.require), so a file of a test run that let one of them go counted as one that hands on any module: the whole library stayed, and every file of the project was a root.
// In a test run only a loader itself, or an object of the loader (require, module, node:module and what hangs below it), that goes somewhere or is called under a name that nobody reads hands on a module.
// Whoever loads through what only leads to a loader a module that the build has not seen is refused aloud.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const name = `"node:" + ["dg", "ram"].join("")`;
const refusal = /Cannot load 'node:dgram': it isn't in this executable/;
const ways: Record<string, { text: string; plain: string; handsOn: boolean; isRefused?: true }> = {
  "process goes to a function": { text: `say(typeof take(process).pid);`, plain: "number", handsOn: false },
  "process off the global object goes to a function": {
    text: `say(typeof take(globalThis.process).pid);`,
    plain: "number",
    handsOn: false,
  },
  "the global object goes to a function": {
    text: `say(typeof take(globalThis).setTimeout);`,
    plain: "function",
    handsOn: false,
  },
  "Bun goes to a function": { text: `say(typeof take(Bun).version);`, plain: "string", handsOn: false },
  "import.meta goes to a function": { text: `say(typeof take(import.meta).dir);`, plain: "string", handsOn: false },
  "a name is looked for on the global object": { text: `say("kept" in globalThis);`, plain: "false", handsOn: false },
  "a name is deleted from the global object": {
    text: `globalThis.kept = 1; delete globalThis.kept; say("kept" in globalThis);`,
    plain: "false",
    handsOn: false,
  },
  // A loader, and what is of the loader, still hand on a module.
  "import.meta.require goes to a function": {
    text: `say(typeof take(import.meta.require)(${name}).createSocket);`,
    plain: "function",
    handsOn: true,
  },
  "process.getBuiltinModule goes to a function": {
    text: `say(typeof take(process.getBuiltinModule)(${name}).createSocket);`,
    plain: "function",
    handsOn: true,
  },
  "process.getBuiltinModule under a made name": {
    text: `say(typeof process.getBuiltinModule(${name}).createSocket);`,
    plain: "function",
    handsOn: true,
  },
  "createRequire goes to a function": {
    text: `say(typeof take(createRequire)(import.meta.url)(${name}).createSocket);`,
    plain: "function",
    handsOn: true,
  },
  "require goes to a function": {
    text: `say(typeof take(require)(${name}).createSocket);`,
    plain: "function",
    handsOn: true,
  },
  // What Bun itself holds is there for whoever asks the host for it.
  "getBuiltinModule through process in other hands": {
    text: `say(typeof take(process).getBuiltinModule(${name}).createSocket);`,
    plain: "function",
    handsOn: false,
  },
  "getBuiltinModule through the global object in other hands": {
    text: `say(typeof take(globalThis).process.getBuiltinModule(${name}).createSocket);`,
    plain: "function",
    handsOn: false,
  },
  // From an answer to a refusal.
  "require through import.meta in other hands": {
    text: `say(typeof take(import.meta).require(${name}).createSocket);`,
    plain: "function",
    handsOn: false,
    isRefused: true,
  },
};

for (const [title, { text, plain, handsOn, isRefused }] of Object.entries(ways))
  test.concurrent(title, async () => {
    using dir = tempDir("aot-leads-to-a-loader", {
      "package.json": `{ "name": "p", "type": "module" }`,
      "a.test.js": `import { test } from "bun:test";\nimport { createRequire } from "node:module";\nconst take = it => it;\nconst say = it => console.error("SEEN " + it);\ntest("t", () => { ${text} });\n`,
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
          .flatMap(line => /\| hands on any module (true|false) \|/.exec(line)?.slice(1, 2) ?? [])
          .slice(0, 1),
        exitCode,
      };
    };
    expect(await seenWith()).toEqual({ seen: ["SEEN " + plain], isRefused: false, found: [], exitCode: 0 });
    expect(await seenWith("--aot")).toEqual({
      seen: isRefused ? [] : ["SEEN " + plain],
      isRefused: isRefused === true,
      found: [String(handsOn)],
      exitCode: isRefused ? 1 : 0,
    });
  });
