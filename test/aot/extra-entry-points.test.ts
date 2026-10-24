import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const see = `const see = v => v === null || (typeof v !== "object" && typeof v !== "function") ? String(v) : typeof v + " " + Object.keys(v).sort().join("+") + " default: " + (v.default === undefined ? "none" : typeof v.default + " " + Object.keys(v.default).sort().join("+"));\n`;

const further: Record<string, string> = {
  "rt/literal.cjs": `module.exports = { names: ["r0"], depth: 1 };\n`,
  "rt/names.cjs": `exports.names = ["r0"]; exports.depth = 1;\n`,
  "rt/value.cjs": `const made = { depth: 1 }; module.exports = made;\n`,
  "rt/function.cjs": `module.exports = function named() {}; module.exports.depth = 1;\n`,
  "rt/text.cjs": `module.exports = "a text";\n`,
  "rt/literal-in-js.js": `module.exports = { names: ["r0"], depth: 1 };\n`,
  "rt/names-in-js.js": `exports.names = ["r0"]; exports.depth = 1;\n`,
  "rt/es.mjs": `export const names = ["r0"]; export const depth = 1; export default 5;\n`,
  "rt/es-in-js.js": `export const names = ["r0"]; export const depth = 1;\n`,
  "rt/counts.cjs": `globalThis.ran = (globalThis.ran ?? 0) + 1; module.exports = { ran: globalThis.ran };\n`,
};
const names = JSON.stringify(Object.keys(further).map(name => "./" + name));
const each = (load: string) =>
  `for (const name of ${names}) { try { console.log(name, see(${load})); } catch (e) { console.log(name, "THROWS", e.constructor.name); } }\n`;

const mains: Record<string, string> = {
  "by-create-require.mjs": `import { createRequire } from "node:module";\n${see}const load = createRequire(import.meta.url);\n${each("load(name)")}console.log(load("./rt/counts.cjs") === load("./rt/counts.cjs"), load("./rt/counts.cjs").ran, load("./rt/es.mjs") === load("./rt/es.mjs"));\n`,
  "by-require.cjs": `${see}const load = require;\n${each("load(name)")}console.log(load("./rt/counts.cjs") === load("./rt/counts.cjs"), load("./rt/counts.cjs").ran);\n`,
  "by-import.mjs": `${see}${each("await import(name)")}`,
  "by-import-then-require.mjs": `import { createRequire } from "node:module";\n${see}const load = createRequire(import.meta.url);\n${each("(await import(name), load(name))")}console.log((await import("./rt/counts.cjs")).default === load("./rt/counts.cjs"), load("./rt/counts.cjs").ran, (await import("./rt/es.mjs")) === load("./rt/es.mjs"));\n`,
  "by-require-then-import.mjs": `import { createRequire } from "node:module";\n${see}const load = createRequire(import.meta.url);\n${each("(load(name), await import(name))")}console.log((await import("./rt/counts.cjs")).default === load("./rt/counts.cjs"), load("./rt/counts.cjs").ran);\n`,
  "by-a-written-name.mjs": `import { createRequire } from "node:module";\nconst loaded = createRequire(import.meta.url)("./rt/literal.cjs");\nconsole.log(Object.keys(loaded).join(), Object.keys(loaded.default ?? {}).join());\n`,
};

async function isAsPlain(main: string, text: string, entries: Record<string, string>) {
  using dir = tempDir("extra-entry-points", { ...entries, [main]: text });
  const plain = await run([bunExe(), "run", main], String(dir), bunEnv);
  expect(plain.exitCode).toBe(0);
  const build = await run(
    [
      bunExe(),
      "build",
      "--compile",
      "--aot",
      "--format=esm",
      "--target=bun",
      main,
      ...Object.keys(entries),
      "--outfile",
      "program",
    ],
    String(dir),
    bunEnv,
  );
  expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
  const aot = await run([join(String(dir), "program")], String(dir), {
    ...bunEnv,
    BUN_JSC_crashIfInterpreterIsUsed: "1",
  });
  expect({ stdout: aot.stdout, exitCode: aot.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
}

for (const main of Object.keys(mains)) {
  test(
    `what an executable made with --aot loads of its further entry points at run time is what bun run loads: ${main}`,
    () => isAsPlain(main, mains[main], further),
    120_000,
  );
}

test(
  "require() of a further entry point does not call a `then` that it exports",
  () =>
    isAsPlain("main.cjs", `const load = require;\nconsole.log(Object.keys(load("./rt/" + "thenable.cjs")).join());\n`, {
      "rt/thenable.cjs": `module.exports = { then() { throw new Error("asked"); } };\n`,
    }),
  120_000,
);
