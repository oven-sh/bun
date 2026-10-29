// Small programs that print in which order the jobs of a program and the steps of a first import() come.

const head = `const log = (globalThis.log = []);
function chain(name, length) {
  let last = Promise.resolve();
  for (let turn = 0; turn < length; turn++) last = last.then(() => void log.push(name + turn));
  return last;
}
globalThis.chain = chain;
const done = () => new Promise(resolve => setTimeout(() => (console.log(log.join(" ")), resolve()), 5));
`;
const use = "const { log, chain } = globalThis;\n";
const leaf = use + 'log.push("a-body");\nchain("a", 16);\nexport const value = 1;\n';
const other = use + 'log.push("b-body");\nchain("b", 16);\nexport const value = 2;\n';
const throws = use + 'log.push("a-body");\nchain("a", 16);\nthrow new Error("thrown");\n';
const imported = 'await import("./a.mjs");\nlog.push("IMPORTED");\nawait done();\n';
const caught = (module: string, label: string) =>
  `try {\n  await import("./${module}.mjs");\n} catch (error) {\n  log.push("${label}-" + error.message);\n}\n`;

type Program = { main: string } & Record<string, string>;

export const programs: Record<string, Program> = {
  "the module queues jobs": { main: imported, a: leaf },
  "the module throws, and is imported again beside a chain": {
    main: caught("a", "CAUGHT") + 'await chain("x", 3);\nchain("b", 20);\n' + caught("a", "AGAIN") + "await done();\n",
    a: throws,
  },
  "the module throws, and is imported again with a chain behind": {
    main:
      caught("a", "CAUGHT") +
      'await chain("x", 20);\nconst again = import("./a.mjs");\nchain("b", 20);\ntry {\n  await again;\n} catch (error) {\n  log.push("AGAIN-" + error.message);\n}\nawait done();\n',
    a: throws,
  },
  "the module throws the same error to whoever imports it again": {
    main:
      'const errors = [];\nfor (let turn = 0; turn < 3; turn++) {\n  try {\n    await import("./a.mjs");\n  } catch (error) {\n    errors.push(error);\n  }\n}\n' +
      "log.push(errors.length, errors[0] === errors[1], errors[1] === errors[2]);\nawait done();\n",
    a: throws,
  },
  "the module binds a name that a built-in module lacks": {
    main:
      'const errors = [];\nfor (let turn = 0; turn < 3; turn++) {\n  chain("w" + turn + "-", 20);\n  try {\n    await import("./a.mjs");\n  } catch (error) {\n    log.push("CAUGHT-" + error.name);\n    errors.push(error);\n  }\n  await chain("x", 24);\n}\n' +
      "log.push(errors.length, errors[0] === errors[1], errors[1] === errors[2]);\nawait done();\n",
    a: 'import { absent } from "node:fs";\nglobalThis.log.push("never" + absent);\n',
  },
  "the module binds a name that a built-in module lacks, and nobody looks on": {
    main:
      'const errors = [];\nfor (let turn = 0; turn < 3; turn++) {\n  try {\n    await import("./a.mjs");\n  } catch (error) {\n    log.push("CAUGHT-" + error.name);\n    errors.push(error);\n  }\n}\n' +
      'log.push(errors.length, errors[0] === errors[1], errors[1] === errors[2]);\nawait import("./b.mjs");\nlog.push("B");\nawait done();\n',
    a: 'import "./low.mjs";\nimport { absent } from "node:fs";\nglobalThis.log.push("never" + absent);\n',
    b: use + 'import "./low.mjs";\nlog.push("b-body");\nchain("b", 12);\n',
    low: use + 'log.push("low-body");\n',
  },
  "the first tick of the program beside a promise job, below a built-in module": {
    main: 'await import("./a.mjs");\nlog.push("IMPORTED");\nawait done();\n',
    a:
      use +
      'import { existsSync } from "node:fs";\nlog.push("a-body" + typeof existsSync);\nprocess.nextTick(() => log.push("tick"));\nPromise.resolve().then(() => log.push("promise job"));\n',
  },
  "the first tick of the program beside a promise job, in a timer": {
    main: 'setTimeout(() => void import("./a.mjs").then(() => log.push("IMPORTED")), 1);\nawait new Promise(resolve => setTimeout(resolve, 4));\nawait done();\n',
    a:
      use +
      'import { existsSync } from "node:fs";\nlog.push("a-body" + typeof existsSync);\nprocess.nextTick(() => log.push("tick"));\nPromise.resolve().then(() => log.push("promise job"));\n',
  },
  "the lowest module throws": {
    main:
      caught("a", "CAUGHT") +
      'await chain("x", 3);\nchain("b", 24);\n' +
      caught("mid", "MID") +
      'await chain("y", 3);\nchain("c", 24);\n' +
      caught("a", "AGAIN") +
      "await done();\n",
    a: use + 'import "./mid.mjs";\nlog.push("a-body");\n',
    mid: use + 'import "./low.mjs";\nlog.push("mid-body");\n',
    low: use + 'log.push("low-body");\nchain("l", 16);\nthrow new Error("low");\n',
  },
  "three levels queue jobs": {
    main: imported,
    a: use + 'import { mid } from "./mid.mjs";\nlog.push("a-body" + mid);\nchain("a", 12);\n',
    mid:
      use + 'import { low } from "./low.mjs";\nlog.push("mid-body");\nchain("m", 12);\nexport const mid = low + 1;\n',
    low: use + 'log.push("low-body");\nchain("l", 12);\nexport const low = 1;\n',
  },
  "a chain begins behind the import()": {
    main: 'const load = import("./a.mjs");\nchain("w", 40);\nawait load;\nlog.push("IMPORTED");\nawait done();\n',
    a: leaf,
  },
  "a chain begins in front of the import()": { main: 'chain("w", 40);\n' + imported, a: leaf },
  "a chain of one job": {
    main: 'const load = import("./a.mjs");\nchain("w", 1);\nawait load;\nlog.push("IMPORTED");\nawait done();\n',
    a: leaf,
  },
  "a chain of three jobs": {
    main: 'const load = import("./a.mjs");\nchain("w", 3);\nawait load;\nlog.push("IMPORTED");\nawait done();\n',
    a: leaf,
  },
  "a chain beside three levels": {
    main: 'const load = import("./a.mjs");\nchain("w", 60);\nawait load;\nlog.push("IMPORTED");\nawait done();\n',
    a: use + 'import { mid } from "./mid.mjs";\nlog.push("a-body" + mid);\n',
    mid: use + 'import { low } from "./low.mjs";\nlog.push("mid-body");\nexport const mid = low + 1;\n',
    low: use + 'log.push("low-body");\nexport const low = 1;\n',
  },
  "two at once": {
    main: 'import("./a.mjs").then(() => log.push("A"));\nimport("./b.mjs").then(() => log.push("B"));\nawait done();\n',
    a: leaf,
    b: other,
  },
  "two at once that share a module": {
    main: 'import("./a.mjs").then(() => log.push("A"));\nimport("./b.mjs").then(() => log.push("B"));\nawait done();\n',
    a: use + 'import "./low.mjs";\nlog.push("a-body");\nchain("a", 16);\n',
    b: use + 'import "./low.mjs";\nlog.push("b-body");\nchain("b", 16);\n',
    low: use + 'log.push("low-body");\nchain("l", 16);\n',
  },
  "three at once of one, two and three levels": {
    main: 'import("./c.mjs").then(() => log.push("C"));\nimport("./b.mjs").then(() => log.push("B"));\nimport("./a.mjs").then(() => log.push("A"));\nawait done();\n',
    a: leaf,
    b: use + 'import "./b1.mjs";\nlog.push("b-body");\nchain("b", 16);\n',
    b1: use + 'log.push("b1-body");\n',
    c: use + 'import "./c1.mjs";\nlog.push("c-body");\nchain("c", 16);\n',
    c1: use + 'import "./c2.mjs";\nlog.push("c1-body");\n',
    c2: use + 'log.push("c2-body");\n',
  },
  "two at once, the second two turns later": {
    main: 'import("./b.mjs").then(() => log.push("B"));\nawait null;\nawait null;\nimport("./a.mjs").then(() => log.push("A"));\nawait done();\n',
    a: leaf,
    b: use + 'import "./b1.mjs";\nlog.push("b-body");\nchain("b", 16);\n',
    b1: use + 'log.push("b1-body");\n',
  },
  "two at once, and the root of the second lies below the first": {
    main: 'import("./b.mjs").then(() => log.push("B"));\nimport("./b1.mjs").then(() => log.push("B1"));\nawait done();\n',
    b: use + 'import "./b1.mjs";\nlog.push("b-body");\nchain("b", 16);\n',
    b1: use + 'log.push("b1-body");\nchain("l", 16);\n',
  },
  "two at once, and the root of the first lies below the second": {
    main: 'import("./b1.mjs").then(() => log.push("B1"));\nimport("./b.mjs").then(() => log.push("B"));\nawait done();\n',
    b: use + 'import "./b1.mjs";\nlog.push("b-body");\nchain("b", 16);\n',
    b1: use + 'log.push("b1-body");\nchain("l", 16);\n',
  },
  "two at once that share a module two levels down, the second three turns later": {
    main: 'import("./a.mjs").then(() => log.push("A"));\nawait null;\nawait null;\nawait null;\nimport("./b.mjs").then(() => log.push("B"));\nchain("w", 40);\nawait done();\n',
    a: use + 'import "./a1.mjs";\nlog.push("a-body");\n',
    a1: use + 'import "./low.mjs";\nlog.push("a1-body");\n',
    b: use + 'import "./b1.mjs";\nlog.push("b-body");\n',
    b1: use + 'import "./low.mjs";\nlog.push("b1-body");\n',
    low: use + 'log.push("low-body");\n',
  },
  "two at once, and the first requires a module of the second while it runs": {
    main: 'import("./a.mjs").then(() => log.push("A"));\nimport("./b.mjs").then(() => log.push("B"));\nawait done();\n',
    a: use + 'log.push("a-body" + require("./b2.mjs").value);\nchain("a", 24);\nexport {};\n',
    b: use + 'import "./b1.mjs";\nlog.push("b-body");\n',
    b1: use + 'import "./b2.mjs";\nlog.push("b1-body");\n',
    b2: use + 'log.push("b2-body");\nexport const value = 5;\n',
  },
  "two at once over one built-in module": {
    main: 'import("./a.mjs").then(() => log.push("A"));\nimport("./b.mjs").then(() => log.push("B"));\nawait done();\n',
    a: use + 'import { gzipSync } from "node:zlib";\nlog.push("a-body" + typeof gzipSync);\nchain("a", 16);\n',
    b: use + 'import "./b1.mjs";\nlog.push("b-body");\nchain("b", 16);\n',
    b1: use + 'import { gunzipSync } from "node:zlib";\nlog.push("b1-body" + typeof gunzipSync);\n',
  },
  "the same module twice": {
    main: 'import("./a.mjs").then(() => log.push("P"));\nimport("./a.mjs").then(() => log.push("Q"));\nawait done();\n',
    a: leaf,
  },
  "the same module again two turns later": {
    main: 'import("./a.mjs").then(() => log.push("P"));\nawait null;\nawait null;\nimport("./a.mjs").then(() => log.push("Q"));\nawait done();\n',
    a: leaf,
  },
  "the module is required behind the import()": {
    main: 'const load = import("./a.mjs");\nlog.push("required" + require("./a.mjs").value);\nload.then(() => log.push("IMPORTED"));\nchain("w", 30);\nawait done();\n',
    a: leaf,
  },
  "an importer of the module is required behind the import()": {
    main: 'const load = import("./a.mjs");\nlog.push("required" + require("./above.mjs").above);\nload.then(() => log.push("IMPORTED"));\nchain("w", 30);\nawait done();\n',
    a: leaf,
    above: use + 'import { value } from "./a.mjs";\nlog.push("above-body");\nexport const above = value + 1;\n',
  },
  "another module is required behind the import()": {
    main: 'const load = import("./a.mjs");\nlog.push("required" + require("./b.mjs").value);\nload.then(() => log.push("IMPORTED"));\nawait done();\n',
    a: leaf,
    b: other,
  },
  "an evaluated module is imported behind the import()": {
    main: 'import "./known.mjs";\nimport("./a.mjs").then(() => log.push("A"));\nimport("./known.mjs").then(() => log.push("KNOWN"));\nawait done();\n',
    a: leaf,
    known: "export const known = 1;\n",
  },
  "the module exports then()": {
    main: 'const got = await import("./a.mjs");\nlog.push("IMPORTED-" + got);\nawait done();\n',
    a:
      use +
      'log.push("a-body");\nchain("a", 20);\nexport function then(resolve) {\n  log.push("then-called");\n  resolve("answer");\n}\n',
  },
  "a CommonJS file below the module has not run": {
    main: imported,
    a: use + 'import file from "./file.cjs";\nlog.push("a-body" + file.present);\nchain("a", 16);\n',
    "file.cjs": 'globalThis.log.push("file");\nglobalThis.chain("f", 20);\nexports.present = 1;\n',
  },
  "a CommonJS file below the module queues nothing": {
    main: imported,
    a: use + 'import file from "./file.cjs";\nlog.push("a-body" + file.present);\nchain("a", 16);\n',
    "file.cjs": 'globalThis.log.push("file");\nexports.present = 1;\n',
  },
  "a CommonJS file two levels below the module queues nothing": {
    main: imported,
    a: use + 'import { mid } from "./mid.mjs";\nlog.push("a-body" + mid);\nchain("a", 16);\n',
    mid: use + 'import file from "./file.cjs";\nlog.push("mid-body");\nexport const mid = file.present;\n',
    "file.cjs": 'globalThis.log.push("file");\nexports.present = 1;\n',
  },
  "a CommonJS file below the module throws": {
    main: caught("a", "CAUGHT") + 'await chain("x", 3);\nchain("b", 24);\n' + caught("a", "AGAIN") + "await done();\n",
    a:
      use +
      'import file from "./file.cjs";\nimport second from "./second.cjs";\nlog.push("a-body" + file.present + second.present);\n',
    "file.cjs":
      'globalThis.log.push("file");\nglobalThis.chain("f", 16);\nexports.present = 1;\nthrow new Error("file");\n',
    "second.cjs": 'globalThis.log.push("second");\nexports.present = 2;\n',
  },
  "a CommonJS file below the module requires the module": {
    main: imported,
    a:
      use +
      'import file from "./file.cjs";\nlog.push("a-body" + file.present);\nchain("a", 16);\nexport const value = 3;\n',
    "file.cjs":
      'globalThis.log.push("file");\nexports.present = 1;\nglobalThis.log.push("file-got-" + Object.keys(require("./a.mjs")).join());\n',
  },
  "a CommonJS file below the module requires another module of the graph": {
    main: imported,
    a:
      use +
      'import file from "./file.cjs";\nimport { low } from "./low.mjs";\nlog.push("a-body" + file.present + low);\nchain("a", 16);\n',
    low: use + 'log.push("low-body");\nchain("l", 16);\nexport const low = 7;\n',
    "file.cjs": 'globalThis.log.push("file");\nexports.present = require("./low.mjs").low;\n',
  },
  "a CommonJS file below the module imports another module": {
    main: imported,
    a: use + 'import file from "./file.cjs";\nlog.push("a-body" + file.present);\nchain("a", 30);\n',
    b: other,
    "file.cjs":
      'globalThis.log.push("file");\nexports.present = 1;\nimport("./b.mjs").then(() => globalThis.log.push("B"));\n',
  },
  "a CommonJS file below the module imports the module": {
    main: imported,
    a: use + 'import file from "./file.cjs";\nlog.push("a-body" + file.present);\nchain("a", 30);\n',
    "file.cjs":
      'globalThis.log.push("file");\nexports.present = 1;\nimport("./a.mjs").then(() => globalThis.log.push("FILE-GOT-A"));\n',
  },
  "a CommonJS file below the module has not run, beside a chain": {
    main: 'const load = import("./a.mjs");\nchain("w", 40);\nawait load;\nlog.push("IMPORTED");\nawait done();\n',
    a: use + 'import { mid } from "./mid.mjs";\nlog.push("a-body" + mid);\n',
    mid: use + 'import file from "./file.cjs";\nlog.push("mid-body");\nexport const mid = file.present;\n',
    "file.cjs": 'globalThis.log.push("file");\nexports.present = 1;\n',
  },
  "a CommonJS file below the module has run": {
    main: 'require("./file.cjs");\nawait chain("x", 3);\n' + imported,
    a: use + 'import file from "./file.cjs";\nlog.push("a-body" + file.present);\nchain("a", 16);\n',
    "file.cjs": 'globalThis.log.push("file");\nexports.present = 1;\n',
  },
  "ticks and timers": {
    main:
      'process.nextTick(() => log.push("tick"));\nsetTimeout(() => log.push("timer"), 0);\nsetImmediate(() => log.push("immediate"));\n' +
      'await import("./a.mjs");\nlog.push("IMPORTED");\nprocess.nextTick(() => log.push("tick2"));\nawait done();\n',
    a: use + 'log.push("a-body");\nchain("a", 16);\nprocess.nextTick(() => log.push("a-tick"));\n',
  },
  "the module imports another while it runs": {
    main: imported,
    a: use + 'log.push("a-body");\nimport("./b.mjs").then(() => log.push("B"));\nchain("a", 30);\n',
    b: other,
  },
  "the module imports itself while it runs": {
    main: imported,
    a: use + 'log.push("a-body");\nimport("./a.mjs").then(() => log.push("SELF"));\nchain("a", 30);\n',
  },
  "in a timer": {
    main: 'setTimeout(async () => {\n  await import("./a.mjs");\n  log.push("IMPORTED");\n}, 0);\nawait new Promise(resolve => setTimeout(resolve, 3));\nawait done();\n',
    a: leaf,
  },
  "one behind the other": {
    main: 'await import("./a.mjs");\nlog.push("A");\nawait import("./b.mjs");\nlog.push("B");\nawait import("./a.mjs");\nlog.push("A-AGAIN");\nawait done();\n',
    a: leaf,
    b: other,
  },
  "the module imports the entry point": {
    main: "export const here = 1;\n" + imported,
    a: use + 'import * as entry from "./main.mjs";\nlog.push("a-body" + typeof entry);\nchain("a", 16);\n',
  },
  "a module below awaits": {
    main: imported,
    a: use + 'import "./waits.mjs";\nlog.push("a-body");\nchain("a", 16);\n',
    waits: use + 'log.push("waits-1");\nchain("v", 16);\nawait null;\nawait null;\nlog.push("waits-2");\n',
  },
  "a job in front of the load imports": {
    main: 'Promise.resolve().then(() => {\n  log.push("job");\n  import("./b.mjs").then(() => log.push("B"));\n});\nimport("./a.mjs").then(() => log.push("A"));\nawait done();\n',
    a: leaf,
    b: other,
  },
  "a job in front of the load requires the module": {
    main: 'Promise.resolve().then(() => log.push("job" + require("./a.mjs").value));\nimport("./a.mjs").then(() => log.push("A"));\nawait done();\n',
    a: leaf,
  },
  "a part was loaded with an earlier graph": {
    main: 'await import("./b.mjs");\nlog.push("B");\nawait chain("x", 12);\nawait import("./a.mjs");\nlog.push("A");\nawait done();\n',
    a: use + 'import "./low.mjs";\nlog.push("a-body");\nchain("a", 16);\n',
    b: use + 'import "./low.mjs";\nlog.push("b-body");\nchain("b", 4);\n',
    low: use + 'log.push("low-body");\n',
  },
  "built-in modules below": {
    main: imported,
    a:
      use +
      'import { basename } from "node:path";\nimport { EventEmitter } from "node:events";\nlog.push("a-body" + basename("/x/y") + typeof EventEmitter);\nchain("a", 16);\n',
  },
  "nobody handles the rejection": {
    main: 'process.on("unhandledRejection", error => log.push("UNHANDLED-" + error.message));\nimport("./a.mjs");\nawait done();\n',
    a: throws,
  },
};

export function make(name: string) {
  const { main, ...rest } = programs[name];
  const files: Record<string, string> = {};
  for (const [file, text] of Object.entries(rest)) files[file.includes(".") ? file : file + ".mjs"] = text;
  return { file: "main.mjs", text: head + main, files };
}

// While a graph of three levels is being loaded beside a chain of jobs, one job of the chain asks for a module. Once for every turn of the chain up to the one in which the graph has run.
const says = (name: string) => `globalThis.log.push(${JSON.stringify(name)});\n`;
export const eventsBesideLoad: Record<
  string,
  { event: (turn: number) => string; files?: (turn: number) => Record<string, string> }
> = {
  "requires the lowest module": { event: turn => `log.push("required" + require("./g${turn}-low.mjs").value)` },
  "requires the module in the middle": { event: turn => `log.push("required" + require("./g${turn}-mid.mjs").value)` },
  "requires the root": { event: turn => `log.push("required" + require("./g${turn}-root.mjs").value)` },
  "requires an importer of the root": {
    event: turn => `log.push("required" + require("./g${turn}-above.mjs").value)`,
    files: turn => ({
      [`g${turn}-above.mjs`]: `import { value as below } from "./g${turn}-root.mjs";\n${says("above")}export const value = below + 1;\n`,
    }),
  },
  "requires a module of no graph": {
    event: turn => `log.push("required" + require("./g${turn}-alone.mjs").value)`,
    files: turn => ({ [`g${turn}-alone.mjs`]: `${says("alone")}export const value = 9;\n` }),
  },
  "requires a graph of its own that queues jobs": {
    event: turn => `log.push("required" + require("./g${turn}-own.mjs").value)`,
    files: turn => ({
      [`g${turn}-own.mjs`]: `import { value as below } from "./g${turn}-own-low.mjs";\n${says("own")}export const value = below + 1;\n`,
      [`g${turn}-own-low.mjs`]: `${says("own-low")}Promise.resolve().then(() => globalThis.log.push("own-job"));\nexport const value = 9;\n`,
    }),
  },
  "requires a module over the lowest module": {
    event: turn => `log.push("required" + require("./g${turn}-over-low.mjs").value)`,
    files: turn => ({
      [`g${turn}-over-low.mjs`]: `import { value as below } from "./g${turn}-low.mjs";\n${says("over-low")}export const value = below + 1;\n`,
    }),
  },
  "imports the root again": { event: turn => `import("./g${turn}-root.mjs").then(() => log.push("AGAIN"))` },
  "imports the lowest module": { event: turn => `import("./g${turn}-low.mjs").then(() => log.push("LOW"))` },
  "imports a graph that shares the lowest module": {
    event: turn => `import("./g${turn}-beside.mjs").then(() => log.push("BESIDE"))`,
    files: turn => ({
      [`g${turn}-beside.mjs`]: `import { value as below } from "./g${turn}-low.mjs";\n${says("beside")}export const value = below + 1;\n`,
    }),
  },
  "imports a module of no graph": {
    event: turn => `import("./g${turn}-alone.mjs").then(() => log.push("ALONE"))`,
    files: turn => ({ [`g${turn}-alone.mjs`]: `${says("alone")}export const value = 9;\n` }),
  },
  "imports an evaluated module": { event: () => `import("./known.mjs").then(() => log.push("KNOWN"))` },
};

export function makeEventBesideLoad(name: string, hasSecondLoad = false) {
  const { event, files: more } = eventsBesideLoad[name];
  const files: Record<string, string> = { "known.mjs": "globalThis.ran = true;\nexport const known = 1;\n" };
  let text = `import "./known.mjs";
const log = (globalThis.log = []);
async function one(at, start, event) {
  log.length = 0;
  const load = start().then(() => log.push("IMPORTED"));
  let last = Promise.resolve();
  for (let turn = 0; turn < 36; turn++)
    last = last.then(() => {
      log.push(String(turn));
      if (turn !== at) return;
      try {
        event();
      } catch (error) {
        log.push("THREW-" + error.name);
      }
    });
  await last;
  await load;
  await new Promise(resolve => setTimeout(resolve, 1));
  console.log(at + ": " + log.join(" "));
}
`;
  for (let turn = 0; turn < 20; turn++) {
    files[`g${turn}-root.mjs`] =
      `import { value as below } from "./g${turn}-mid.mjs";\n${says("root")}export const value = below + 1;\n`;
    files[`g${turn}-mid.mjs`] =
      `import { value as below } from "./g${turn}-low.mjs";\n${says("mid")}export const value = below + 1;\n`;
    files[`g${turn}-low.mjs`] = `${says("low")}export const value = 1;\n`;
    Object.assign(files, more?.(turn));
    if (hasSecondLoad) {
      files[`g${turn}-second.mjs`] = `import "./g${turn}-second-low.mjs";\n${says("second")}`;
      files[`g${turn}-second-low.mjs`] = says("second-low");
    }
    const second = hasSecondLoad ? `(import("./g${turn}-second.mjs").then(() => log.push("SECOND")), ` : "(";
    text += `await one(${turn}, () => ${second}import("./g${turn}-root.mjs")), () => ${event(turn)});\n`;
  }
  return { file: "main.mjs", text, files };
}
