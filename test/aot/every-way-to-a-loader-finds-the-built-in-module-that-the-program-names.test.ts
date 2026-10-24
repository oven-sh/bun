// Each program asks for node:dgram, which nothing else in it names, and brings the loader and the name together in a way of its own: a variable, a parameter, a property, a list, `call`, another file.
// Each is compiled alone, because a module that one way keeps is there for every other, and prints what plain Bun prints.
// A name that the program does not write (it comes out of the environment) finds no module that nothing names. The build says so at the call.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { run } from "./harness/run";
import { describe, test } from "./supported";

const name = "node:dgram";
const show = (asked: string) =>
  `let answer;\ntry { answer = typeof (${asked})?.createSocket; } catch (error) { answer = error.code; }\nconsole.log(answer);\n`;
const showLater = (asked: string) => show(`await (${asked})`);

const elsewhere = `export const held = process;
export const load = process.getBuiltinModule;
export function ask(name) { return process.getBuiltinModule(name); }
`;

const namesElsewhere = `export const names = ["${name}"];
export const isNamed = asked => names.includes(asked);
export default "${name}";
`;

type Way = [label: string, extension: "mjs" | "cjs", text: string];

const holdersOfProcess: Way[] = [
  ["process itself", "mjs", show(`process.getBuiltinModule("${name}")`)],
  ["a constant", "mjs", `const p = process;\n` + show(`p.getBuiltinModule("${name}")`)],
  ["a variable that nothing stores to", "mjs", `let p = process;\n` + show(`p.getBuiltinModule("${name}")`)],
  ["a variable that is stored to", "mjs", `let p = null;\np = process;\n` + show(`p.getBuiltinModule("${name}")`)],
  ["a parameter", "mjs", `function f(p) { return p.getBuiltinModule("${name}"); }\n` + show(`f(process)`)],
  ["a parameter's default", "mjs", `function f(p = process) { return p.getBuiltinModule("${name}"); }\n` + show(`f()`)],
  ["a property", "mjs", `const o = { p: process };\n` + show(`o.p.getBuiltinModule("${name}")`)],
  ["an element", "mjs", show(`[process][0].getBuiltinModule("${name}")`)],
  [
    "a field",
    "mjs",
    `class A { p = process; m() { return this.p.getBuiltinModule("${name}"); } }\n` + show(`new A().m()`),
  ],
  ["what a function returns", "mjs", `const get = () => process;\n` + show(`get().getBuiltinModule("${name}")`)],
  [
    "a pattern over the global object",
    "mjs",
    `const { process: p } = globalThis;\n` + show(`p.getBuiltinModule("${name}")`),
  ],
  [
    "one arm of a choice",
    "mjs",
    `const p = typeof process !== "undefined" ? process : undefined;\n` + show(`p?.getBuiltinModule?.("${name}")`),
  ],
  ["the left of ||", "mjs", `const p = globalThis.process || {};\n` + show(`p.getBuiltinModule?.("${name}")`)],
  [
    "a choice of global objects",
    "mjs",
    `const g = typeof globalThis !== "undefined" ? globalThis : global;\n` +
      show(`g.process.getBuiltinModule("${name}")`),
  ],
  [
    "a test in front",
    "mjs",
    show(`typeof process === "object" && process.getBuiltinModule ? process.getBuiltinModule("${name}") : null`),
  ],
  ["a constant key of the global object", "mjs", show(`globalThis["process"].getBuiltinModule("${name}")`)],
  ["self", "mjs", show(`self.process.getBuiltinModule("${name}")`)],
  [
    "the default export of node:process",
    "mjs",
    `import p from "node:process";\n` + show(`p.getBuiltinModule("${name}")`),
  ],
  [
    "the namespace of node:process",
    "mjs",
    `import * as p from "node:process";\n` + show(`p.getBuiltinModule("${name}")`),
  ],
  ["require of node:process", "cjs", show(`require("node:process").getBuiltinModule("${name}")`)],
  ["another file", "mjs", `import { held } from "./elsewhere.mjs";\n` + show(`held.getBuiltinModule("${name}")`)],
];

const holdersOfGetBuiltinModule: Way[] = [
  ["a constant", "mjs", `const load = process.getBuiltinModule;\n` + show(`load("${name}")`)],
  ["a pattern", "mjs", `const { getBuiltinModule } = process;\n` + show(`getBuiltinModule("${name}")`)],
  ["a parameter", "mjs", `function f(load) { return load("${name}"); }\n` + show(`f(process.getBuiltinModule)`)],
  ["a constant key", "mjs", show(`process["getBuiltinModule"]("${name}")`)],
  ["call", "mjs", show(`process.getBuiltinModule.call(process, "${name}")`)],
  ["apply", "mjs", show(`process.getBuiltinModule.apply(process, ["${name}"])`)],
  ["bind", "mjs", show(`process.getBuiltinModule.bind(process)("${name}")`)],
  ["Reflect.apply", "mjs", show(`Reflect.apply(process.getBuiltinModule, process, ["${name}"])`)],
  [
    "an import from node:process",
    "mjs",
    `import { getBuiltinModule } from "node:process";\n` + show(`getBuiltinModule("${name}")`),
  ],
  ["another file", "mjs", `import { load } from "./elsewhere.mjs";\n` + show(`load("${name}")`)],
];

const holdersOfTheName: Way[] = [
  ["a constant", "mjs", `const n = "${name}";\n` + show(`process.getBuiltinModule(n)`)],
  ["a variable", "mjs", `let n = "${name}";\n` + show(`process.getBuiltinModule(n)`)],
  ["a parameter", "mjs", `function load(n) { return process.getBuiltinModule(n); }\n` + show(`load("${name}")`)],
  ["a parameter of another file", "mjs", `import { ask } from "./elsewhere.mjs";\n` + show(`ask("${name}")`)],
  [
    "a list",
    "mjs",
    `let found;\nfor (const n of ["${name}"]) try { found = process.getBuiltinModule(n); } catch {}\n` + show(`found`),
  ],
  [
    "a list that is searched and read",
    "mjs",
    `const names = ["${name}"];\n` + show(`names.includes("${name}") && process.getBuiltinModule(names[0])`),
  ],
  [
    "a list under a second name",
    "mjs",
    `const names = ["${name}"];\nconst again = names;\n` +
      show(`names.includes("${name}") && process.getBuiltinModule(again.at(0))`),
  ],
  [
    "a list that a variable gets later",
    "mjs",
    `let names;\nnames = ["${name}"];\n` +
      show(`names.indexOf("${name}") === 0 && process.getBuiltinModule(names.pop())`),
  ],
  [
    "a set",
    "mjs",
    `const names = new Set(["${name}"]);\nlet found;\nfor (const n of names) if (names.has(n)) found = process.getBuiltinModule(n);\n` +
      show(`found`),
  ],
  [
    "a set made of a list",
    "mjs",
    `const list = ["${name}"];\nconst names = new Set(list);\n` +
      show(`list.includes("${name}") && process.getBuiltinModule([...names][0])`),
  ],
  [
    "a list of another file",
    "mjs",
    `import { names } from "./names.mjs";\n` + show(`process.getBuiltinModule(names[0])`),
  ],
  ["the default export of another file", "mjs", `import n from "./names.mjs";\n` + show(`process.getBuiltinModule(n)`)],
  ["a table", "mjs", `const names = { d: "${name}" };\n` + show(`process.getBuiltinModule(names.d)`)],
  ["two constants joined", "mjs", show(`process.getBuiltinModule("node:" + "dgram")`)],
  ["a template", "mjs", `const d = "dgram";\n` + show("process.getBuiltinModule(`node:${d}`)")],
  [
    "a parameter behind the prefix",
    "mjs",
    `function load(n) { return process.getBuiltinModule("node:" + n); }\n` + show(`load("dgram")`),
  ],
];

const waysToRequire: Way[] = [
  ["require itself", "cjs", show(`require("${name}")`)],
  ["require in an ES module", "mjs", show(`require("${name}")`)],
  ["a constant", "cjs", `const r = require;\n` + show(`r("${name}")`)],
  ["a variable", "cjs", `let r = require;\n` + show(`r("${name}")`)],
  ["one arm of a choice", "cjs", `const r = typeof require === "function" ? require : null;\n` + show(`r("${name}")`)],
  ["a parameter", "cjs", `function f(r) { return r("${name}"); }\n` + show(`f(require)`)],
  ["a property", "cjs", `const o = { r: require };\n` + show(`o.r("${name}")`)],
  [
    "a helper that swallows the error",
    "cjs",
    `function tryRequire(n) { try { return require(n); } catch { return null; } }\n` + show(`tryRequire("${name}")`),
  ],
  [
    "the same without the prefix",
    "cjs",
    `function tryRequire(n) { try { return require(n); } catch { return null; } }\n` + show(`tryRequire("dgram")`),
  ],
  [
    "a list of names",
    "cjs",
    `let found;\nfor (const n of ["${name}"]) try { found = require(n); } catch {}\n` + show(`found`),
  ],
  ["a table of names", "cjs", `const names = { d: "${name}" };\n` + show(`require(names.d)`)],
  [
    "a parameter behind the prefix",
    "cjs",
    `function load(n) { return require("node:" + n); }\n` + show(`load("dgram")`),
  ],
  ["what eval answers", "cjs", show(`eval("require")("${name}")`)],
  ["module.require", "cjs", show(`module.require("${name}")`)],
  ["module?.require?.()", "cjs", show(`module?.require?.("${name}")`)],
  ["a constant that holds module", "cjs", `const m = module;\n` + show(`m.require("${name}")`)],
  [
    "a parameter that holds module",
    "cjs",
    `function f(m, n) { return m.require(n); }\n` + show(`f(module, "${name}")`),
  ],
  ["a pattern over module", "cjs", `const { require: r } = module;\n` + show(`r.call(module, "${name}")`)],
  [
    "module.require, bound",
    "cjs",
    `const r = typeof module.require === "function" && module.require.bind(module);\n` + show(`r("${name}")`),
  ],
  ["Module.prototype.require", "cjs", show(`require("module").prototype.require.call(module, "${name}")`)],
  ["import.meta.require", "mjs", show(`import.meta.require("${name}")`)],
  ["a constant that holds import.meta", "mjs", `const meta = import.meta;\n` + show(`meta.require("${name}")`)],
  ["a pattern over import.meta", "mjs", `const { require: r } = import.meta;\n` + show(`r("${name}")`)],
  ["a constant that holds import.meta.require", "mjs", `const r = import.meta.require;\n` + show(`r("${name}")`)],
  [
    "a parameter that holds import.meta.require",
    "mjs",
    `function f(r) { return r("${name}"); }\n` + show(`f(import.meta.require)`),
  ],
];

const createRequire = `import { createRequire } from "node:module";\n`;
const waysToMadeRequire: Way[] = [
  ["a named import", "mjs", createRequire + `const r = createRequire(import.meta.url);\n` + show(`r("${name}")`)],
  [
    "the default import",
    "mjs",
    `import Module from "node:module";\nconst r = Module.createRequire(import.meta.url);\n` + show(`r("${name}")`),
  ],
  [
    "the namespace",
    "mjs",
    `import * as Module from "node:module";\nconst r = Module.createRequire(import.meta.url);\n` + show(`r("${name}")`),
  ],
  [
    "another name of createRequire",
    "mjs",
    createRequire + `const make = createRequire;\nconst r = make(import.meta.url);\n` + show(`r("${name}")`),
  ],
  [
    "a parameter",
    "mjs",
    createRequire + `function f(r) { return r("${name}"); }\n` + show(`f(createRequire(import.meta.url))`),
  ],
  [
    "a variable that is stored to",
    "mjs",
    createRequire + `let r;\nr = createRequire(import.meta.url);\n` + show(`r("${name}")`),
  ],
  [
    "made at the first call",
    "mjs",
    createRequire +
      `let r;\nfunction load(n) { r ??= createRequire(import.meta.url); return r(n); }\n` +
      show(`load("${name}")`),
  ],
  [
    "made in a function",
    "mjs",
    createRequire +
      `function load() { const r = createRequire(import.meta.url); return r("${name}"); }\n` +
      show(`load()`),
  ],
  [
    "node:module by getBuiltinModule",
    "mjs",
    `const r = process.getBuiltinModule("node:module").createRequire(import.meta.url);\n` + show(`r("${name}")`),
  ],
  [
    "node:module by import()",
    "mjs",
    `const { createRequire } = await import("node:module");\nconst r = createRequire(import.meta.url);\n` +
      show(`r("${name}")`),
  ],
];

const waysToImport: Way[] = [
  ["a constant name", "mjs", showLater(`import("${name}")`)],
  ["a constant that holds the name", "mjs", `const n = "${name}";\n` + showLater(`import(n)`)],
  ["a parameter", "mjs", `function load(n) { return import(n); }\n` + showLater(`load("${name}")`)],
  [
    "a list",
    "mjs",
    `let found;\nfor (const n of ["${name}"]) try { found = await import(n); } catch {}\n` + show(`found`),
  ],
];

const groups: [string, Way[]][] = [
  ["process is held by", holdersOfProcess],
  ["process.getBuiltinModule is held by", holdersOfGetBuiltinModule],
  ["the name is held by", holdersOfTheName],
  ["require:", waysToRequire],
  ["a require that createRequire makes:", waysToMadeRequire],
  ["import():", waysToImport],
];

async function runBothWays(extension: string, text: string, env: Record<string, string | undefined> = bunEnv) {
  using folder = tempDir("aot-way-to-a-loader", {
    [`program.${extension}`]: text,
    "elsewhere.mjs": elsewhere,
    "names.mjs": namesElsewhere,
  });
  const program = join(String(folder), `program.${extension}`);
  const [plain, compiled] = await Promise.all([
    run([bunExe(), program], String(folder), env),
    run([bunExe(), "run", "--debug-aot", program], String(folder), { ...env, BUN_JSC_crashIfInterpreterIsUsed: "1" }),
  ]);
  const warnings = compiled.stderr.split("\n").filter(line => line.startsWith("warn: TS100064: "));
  return { plain, compiled, warnings };
}

for (const [group, ways] of groups) {
  describe(group, () => {
    test.concurrent.each(ways)(
      "%s",
      async (_, extension, text) => {
        const { plain, compiled } = await runBothWays(extension, text);
        expect(plain).toMatchObject({ stdout: "function\n", exitCode: 0 });
        expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
      },
      120_000,
    );
  });
}

describe("a name that the program does not write finds no module that nothing names, and the build warns at", () => {
  const fromOutside: Way[] = [
    ["process.getBuiltinModule(name)", "mjs", show(`process.getBuiltinModule(process.env.NAME_OF_MODULE)`)],
    [
      "a constant that holds process.getBuiltinModule",
      "mjs",
      `const load = process.getBuiltinModule;\n` + show(`load(process.env.NAME_OF_MODULE)`),
    ],
    ["require(name)", "cjs", show(`require(process.env.NAME_OF_MODULE)`)],
    ["import(name)", "mjs", showLater(`import(process.env.NAME_OF_MODULE)`)],
  ];
  test.concurrent.each(fromOutside)(
    "%s",
    async (_, extension, text) => {
      const { plain, compiled, warnings } = await runBothWays(extension, text, { ...bunEnv, NAME_OF_MODULE: name });
      expect(plain).toMatchObject({ stdout: "function\n", exitCode: 0 });
      expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({
        stdout: expect.stringMatching(/^(ERR_)?MODULE_NOT_FOUND\n$/),
        exitCode: 0,
      });
      expect(warnings).toHaveLength(1);
    },
    120_000,
  );
});

describe("a text that comes to no loader keeps no module:", () => {
  const asked = "process.env.NAME_OF_MODULE";
  const ask = show(`require(${asked})`);
  const texts: Way[] = [
    ["compared", "cjs", `if (process.env.NAME_OF_MODULE === "${name}") console.log("asked");\n` + ask],
    ["a case", "cjs", `switch (process.env.NAME_OF_MODULE) { case "${name}": console.log("asked"); }\n` + ask],
    ["a key", "cjs", `console.log({ asked: 1 }["${name}"] ?? "asked");\n` + ask],
    [
      "in a list that is searched where it is written",
      "cjs",
      `if (["${name}"].includes(${asked})) console.log("asked");\n` + ask,
    ],
    [
      "in a list that is only searched",
      "cjs",
      `const names = ["${name}"];\nif (names.includes(${asked}) && names.indexOf(${asked}) === 0 && names.length === 1) console.log("asked");\n` +
        ask,
    ],
    [
      "in a list that a variable gets later and that is only searched",
      "cjs",
      `var names;\nfunction fill() { names = ["${name}"]; }\nfill();\nif (names.lastIndexOf(${asked}) === 0) console.log("asked");\n` +
        ask,
    ],
    [
      "in a set that is only asked",
      "cjs",
      `const names = new Set(["${name}"]);\nif (names.has(${asked}) && names.size === 1) console.log("asked");\n` + ask,
    ],
    [
      "in a set made of lists that are only searched",
      "cjs",
      `const list = Object.freeze(["${name}"]);\nconst names = new Set([...list, "other"]);\nif (names.has(${asked}) && list.includes(${asked})) console.log("asked");\n` +
        ask,
    ],
    [
      "in a variable that is only compared",
      "cjs",
      `const n = "${name}";\nif (${asked} === n) console.log("asked");\n` + ask,
    ],
    ["in code that never runs", "cjs", `if (false) console.log("${name}");\nconsole.log("asked");\n` + ask],
  ];
  test.concurrent.each(texts)(
    "%s",
    async (_, extension, text) => {
      const { compiled } = await runBothWays(extension, text, { ...bunEnv, NAME_OF_MODULE: name });
      expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({
        stdout: "asked\nMODULE_NOT_FOUND\n",
        exitCode: 0,
      });
    },
    120_000,
  );
});
