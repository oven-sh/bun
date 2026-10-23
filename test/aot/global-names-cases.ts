// A free name (one that no file declares) is a global: a script's variable, or a property of the global object or its prototype chain.
// --aot resolves it at build time when it can prove the answer: the global is locked, or nothing in the program can create, replace
// or shadow it. Every other name gets one record in the executable, filled on first use, that holds the value or its location.
//
// Each program reads a name a few times to fill whatever caches the answer, then changes the global and reads the name again.
// The output must match plain Bun's.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildFlags, compileCommand, runtimeEnvironment, withLimit } from "./harness/flags";
import { built, slot, spawned, told, wanted, withoutCoreDump } from "./run-programs";
import { describe, test } from "./supported";

const groups: [name: string, body: () => void][] = [];
const group = (name: string, body: () => void) => void groups.push([name, body]);
let halfOfPrograms = 0;

type Program = {
  /** `main.*` is the entry point; `worker.*` is a second entry point. */
  files: Record<string, string>;
  /** The program evaluates strings as code, which the interpreter runs. */
  evaluatesStrings?: true;
  exitCode?: number;
  /** Plain Bun and the executable each run once per environment. */
  environments?: Record<string, string>[];
};

const tsconfig = JSON.stringify({
  compilerOptions: { target: "esnext", module: "preserve", moduleResolution: "bundler", strict: true, noEmit: true, skipLibCheck: true },
});

// --aot has its own wording for some TypeErrors, so only a TypeError's name is printed.
const helpers = `const opaque = value => new CustomEvent("opaque", { detail: value }).detail; // the compiler can't see through a value returned by native code
const decoded = text => Buffer.from(text).toString(); // or a string decoded at run time
const told = [];
function attempt(action) {
  try {
    told.push(String(action()));
  } catch (error) {
    told.push(error instanceof TypeError ? error.name : error.name + ": " + error.message);
  }
}
`;
const tell = `console.log(told.join("\\n"));
`;
const javaScript = (text: string) => helpers + text + tell;

const assignToMissingName = javaScript(`function store(value) { fresh = value; }
function read() { return fresh; }
function kind() { return typeof fresh; }
attempt(kind);
attempt(read);
attempt(() => store(1));
attempt(kind);
attempt(read);
attempt(() => JSON.stringify(Object.getOwnPropertyDescriptor(globalThis, "fresh")));
globalThis.fresh = 2;
attempt(read);
attempt(() => store(3));
attempt(read);
attempt(() => Reflect.deleteProperty(globalThis, "fresh"));
attempt(kind);
attempt(() => store(4));
attempt(kind);
`);

const assignToReadOnlyGlobal = javaScript(`Object.defineProperty(globalThis, "fixed", { value: "fixed", writable: false, enumerable: true, configurable: false });
function read() { return fixed; }
function store(value) { fixed = value; }
attempt(read);
attempt(read);
attempt(() => store("replaced"));
attempt(read);
attempt(() => Reflect.set(globalThis, "fixed", "replaced"));
attempt(() => Reflect.deleteProperty(globalThis, "fixed"));
attempt(read);
`);

const programs: Record<string, Program> = {
  "a global the program sets once": {
    files: {
      "tsconfig.json": tsconfig,
      "main.ts": `declare var foo: number;
(globalThis as any).foo = 1;
function twice(): number {
  return foo + foo;
}
function total(rounds: number): number {
  let sum = 0;
  for (let round = 0; round < rounds; round++) sum += foo;
  return sum;
}
console.log(foo, typeof foo, twice(), twice(), total(100), (globalThis as any).foo);
export {};
`,
    },
  },

  "an assignment after the value was read": {
    files: {
      "main.mjs": javaScript(`globalThis.counter = 1;
function read() { return counter; }
function total(rounds) {
  let sum = 0;
  for (let round = 0; round < rounds; round++) sum += counter;
  return sum;
}
attempt(read);
attempt(read);
attempt(() => total(100));
globalThis.counter = 2;
attempt(read);
attempt(() => total(100));
counter = 3;
attempt(read);
attempt(() => globalThis.counter);
Reflect.set(globalThis, "counter", 4);
attempt(read);
Object.defineProperty(globalThis, "counter", { value: 5 });
attempt(read);
opaque(globalThis).counter = 6;
attempt(read);
globalThis[decoded("counter")] = 7;
attempt(read);
attempt(() => total(100));
`),
    },
  },

  "a global that is deleted and set again": {
    files: {
      "main.mjs": javaScript(`globalThis.temporary = "here";
function read() { return temporary; }
function kind() { return typeof temporary; }
attempt(read);
attempt(read);
attempt(kind);
attempt(() => delete globalThis.temporary);
attempt(read);
attempt(kind);
attempt(() => "temporary" in globalThis);
globalThis.temporary = "back";
attempt(read);
attempt(kind);
`),
    },
  },

  "a global that becomes a getter, then a value again": {
    files: {
      "main.mjs": javaScript(`globalThis.level = 1;
function read() { return level; }
function store(value) { level = value; }
attempt(read);
attempt(read);
let asked = 0;
Object.defineProperty(globalThis, "level", {
  get() { return "asked " + ++asked; },
  set(value) { told.push("set " + value); },
  configurable: true,
});
attempt(read);
attempt(read);
attempt(() => store(7));
attempt(read);
Object.defineProperty(globalThis, "level", { value: "a value again", writable: true, configurable: true });
attempt(read);
attempt(read);
attempt(() => store("stored"));
attempt(read);
attempt(() => asked);
`),
    },
  },

  "a script's let shadows a global that was read": {
    evaluatesStrings: true,
    files: {
      "main.mjs": javaScript(`import vm from "node:vm";
globalThis.shade = "property";
function read() { return shade; }
function member() { return globalThis.shade; }
function store(value) { shade = value; }
attempt(read);
attempt(read);
attempt(member);
vm.runInThisContext("let shade = 'variable';");
attempt(read);
attempt(read);
attempt(member);
store("stored by name");
attempt(read);
attempt(member);
attempt(() => vm.runInThisContext("shade"));
attempt(() => delete globalThis.shade);
attempt(read);
attempt(member);
`),
    },
  },

  "a script's let shadows a name the global object inherits": {
    evaluatesStrings: true,
    files: {
      "main.mjs": javaScript(`import vm from "node:vm";
function read() { return toString; }
function kind() { return typeof toString; }
attempt(kind);
attempt(kind);
attempt(() => read() === Object.prototype.toString);
vm.runInThisContext("let toString = 1;");
attempt(read);
attempt(kind);
attempt(() => typeof globalThis.toString);
`),
    },
  },

  "the dead zone of a script's let": {
    evaluatesStrings: true,
    files: {
      "main.mjs": javaScript(`import vm from "node:vm";
function read() { return pending; }
function kind() { return typeof pending; }
function readNever() { return never; }
function kindOfNever() { return typeof never; }
globalThis.readPending = read;
globalThis.readNever = readNever;
attempt(kind);
attempt(read);
attempt(() => vm.runInThisContext("var seen = []; try { seen.push(readPending()); } catch (error) { seen.push(error.name + ': ' + error.message); } let pending = 'ready'; seen.push(readPending()); seen.join(' | ')"));
attempt(read);
attempt(kind);
attempt(kindOfNever);
attempt(() => vm.runInThisContext("readNever(); let never = 1;"));
attempt(readNever);
attempt(readNever);
attempt(kindOfNever);
`),
    },
  },

  "a script's const and class": {
    evaluatesStrings: true,
    files: {
      "main.mjs": javaScript(`import vm from "node:vm";
vm.runInThisContext("const limit = 10; const box = { n: 1 }; class Made { static label = 'made by a script'; }");
function readLimit() { return limit; }
function readBox() { return box.n; }
function readClass() { return Made.label; }
function store(value) { limit = value; }
attempt(readLimit);
attempt(readLimit);
attempt(readBox);
attempt(readClass);
attempt(() => store(11));
attempt(readLimit);
box.n = 2;
attempt(readBox);
attempt(() => "limit" in globalThis);
attempt(() => vm.runInThisContext("limit + box.n"));
`),
    },
  },

  "the global object's storage grows, then becomes a dictionary": {
    files: {
      "main.mjs": javaScript(`globalThis.early = "early";
function readEarly() { return early; }
function storeEarly(value) { early = value; }
function readLate() { return late; }
function storeLate(value) { late = value; }
function readFiller() { return filler399; }
attempt(readEarly);
storeEarly("early, stored once");
attempt(readEarly);
for (let index = 0; index < 400; index++) globalThis["filler" + index] = index;
globalThis.late = "late";
attempt(readEarly);
attempt(readLate);
attempt(readLate);
attempt(readFiller);
for (let index = 400; index < 800; index++) globalThis["filler" + index] = index;
attempt(readEarly);
attempt(readLate);
attempt(readFiller);
storeEarly("early, stored twice");
storeLate("late, stored once");
attempt(readEarly);
attempt(readLate);
for (let index = 0; index < 800; index += 2) delete globalThis["filler" + index];
attempt(readEarly);
attempt(readLate);
attempt(readFiller);
storeEarly("early, stored in a dictionary");
storeLate("late, stored in a dictionary");
attempt(readEarly);
attempt(readLate);
attempt(() => globalThis.early + " / " + globalThis.late);
attempt(() => delete globalThis.filler399);
attempt(readFiller);
`),
    },
  },

  "globals the host creates lazily": {
    files: {
      "main.mjs": javaScript(`function readCrypto() { return crypto; }
function readNavigator() { return navigator; }
function readPerformance() { return performance; }
function readChannel() { return BroadcastChannel; }
function readTimer() { return setTimeout; }
for (const read of [readCrypto, readNavigator, readPerformance, readChannel, readTimer]) {
  attempt(() => read() === read());
  attempt(() => typeof read());
}
attempt(() => readCrypto() === globalThis.crypto);
attempt(() => readNavigator() === globalThis.navigator);
attempt(() => readPerformance() === globalThis.performance);
attempt(() => readChannel() === globalThis.BroadcastChannel);
attempt(() => readTimer() === globalThis.setTimeout);
attempt(() => typeof readCrypto().randomUUID + " " + readChannel().name + " " + typeof readPerformance().now());
`),
    },
  },

  "a host global replaced after it was read": {
    files: {
      "main.mjs": javaScript(`function read() { return fetch; }
function call(url) { return fetch(url); }
function copy(value) { return structuredClone(value); }
const original = fetch;
attempt(() => read() === original);
attempt(() => read() === original);
attempt(() => copy("a copy"));
globalThis.fetch = url => "not fetched: " + url;
attempt(() => read() === original);
attempt(() => call("x:"));
structuredClone = value => "not cloned: " + value;
attempt(() => copy("a copy"));
attempt(() => globalThis.structuredClone("by member"));
globalThis.fetch = original;
attempt(() => read() === original);
`),
    },
  },

  "native code and the GC see an assignment by name": {
    files: {
      "main.mjs": javaScript(`globalThis.tally = 0;
function bump() { tally = tally + 1; }
for (let round = 0; round < 1000; round++) bump();
attempt(() => tally);
attempt(() => globalThis.tally);
attempt(() => Reflect.get(globalThis, "tally"));
attempt(() => JSON.stringify(Object.getOwnPropertyDescriptor(globalThis, "tally")));
attempt(() => Object.keys(globalThis).includes("tally"));

globalThis.kept = null;
function keep(value) { kept = value; }
function readKept() { return kept; }
const ring = new Array(64);
keep({ n: -1, list: [] });
Bun.gc(true);
for (let round = 0; round < 200; round++) {
  keep({ n: round, list: [round, round + 1] });
  for (let index = 0; index < 5000; index++) ring[index & 63] = { index, list: [index] };
  if (readKept().n !== round || readKept().list[1] !== round + 1) told.push("lost in round " + round);
}
Bun.gc(true);
attempt(() => readKept().n + " " + readKept().list.join() + " " + ring[63].index);
`),
    },
  },

  "a worker has its own globals": {
    files: {
      "main.mjs": `import { Worker } from "node:worker_threads";
import { kind, read, store } from "./shared.mjs";
globalThis.place = "main thread";
const before = [read(), read()];
const fromWorker = await new Promise((resolve, reject) => {
  const worker = new Worker("./worker.mjs");
  worker.once("message", resolve);
  worker.once("error", reject);
});
console.log(before.join());
console.log(fromWorker);
console.log(read(), kind());
store("stored on the main thread");
console.log(read(), globalThis.place);
`,
      "worker.mjs": `import { parentPort } from "node:worker_threads";
import { kind, read, store } from "./shared.mjs";
const told = [kind()];
try {
  told.push(read());
} catch (error) {
  told.push(error.name + ": " + error.message);
}
globalThis.place = "worker";
told.push(read(), read());
store("stored in the worker");
told.push(read(), globalThis.place);
parentPort.postMessage(told.join());
`,
      "shared.mjs": `export function read() { return place; }
export function store(value) { place = value; }
export function kind() { return typeof place; }
`,
    },
  },

  "a vm context has its own globals": {
    evaluatesStrings: true,
    files: {
      "main.mjs": javaScript(`import vm from "node:vm";
globalThis.place = "the realm of the program";
function read() { return place; }
function kind() { return typeof place; }
function store(value) { place = value; }
const context = vm.createContext({ read, kind, store, place: "the context" });
attempt(read);
attempt(() => vm.runInContext("place + ' / ' + read() + ' / ' + kind()", context));
attempt(() => vm.runInContext("place = 'changed in the context'; read()", context));
attempt(() => vm.runInContext("store('stored from the context'); place", context));
attempt(read);
attempt(() => context.place);
`),
    },
  },

  "typeof of missing and existing names": {
    files: {
      "main.mjs": javaScript(`function kinds() {
  return [typeof window, typeof document, typeof Deno, typeof process, typeof Bun, typeof globalThis, typeof undefined, typeof NaN, typeof Array, typeof fetch, typeof navigator, typeof self, typeof global].join();
}
function isBrowser() { return typeof window !== "undefined" && typeof window.document !== "undefined"; }
function isNode() { return typeof process !== "undefined" && process.versions != null && process.versions.node != null; }
function location() {
  if (typeof window === "undefined") return "no window";
  return window.location.href;
}
attempt(kinds);
attempt(kinds);
attempt(isBrowser);
attempt(isNode);
attempt(location);
`),
    },
  },

  "a missing name": {
    files: {
      "main.mjs": javaScript(`function member() { return globalThis.nope; }
function name() { return nope; }
function kind() { return typeof nope; }
function kindOfMember() { return typeof globalThis.nope; }
function has() { return "nope" in globalThis; }
function call() { return nope(); }
function callMember() { return globalThis.nope(); }
for (const action of [member, name, kind, kindOfMember, has, call, callMember]) {
  attempt(action);
  attempt(action);
}
`),
    },
  },

  "an uncaught read of a missing name": {
    exitCode: 1,
    files: {
      "main.mjs": `function read() { return nowhere; }
console.log("before");
read();
console.log("after");
`,
    },
  },

  "globalThis.undefined, globalThis.NaN and globalThis.Infinity": {
    files: {
      "main.mjs": javaScript(`function members() { return [globalThis.undefined, globalThis.NaN, globalThis.Infinity, -globalThis.Infinity].join(); }
function kinds() { return [typeof globalThis.undefined, typeof globalThis.NaN, typeof globalThis.Infinity].join(); }
attempt(members);
attempt(kinds);
attempt(() => globalThis.undefined === undefined && "undefined" in globalThis);
attempt(() => JSON.stringify(Object.getOwnPropertyDescriptor(globalThis, "undefined")));
`),
    },
  },

  "gc, which --expose-gc adds at run time": {
    environments: [{}, { BUN_OPTIONS: "--expose-gc" }],
    files: {
      "main.mjs": javaScript(`function kinds() { return [typeof gc, typeof globalThis.gc, "gc" in globalThis].join(); }
function collect() { return typeof gc === "function" ? typeof gc() : "no gc"; }
function member() { return globalThis.gc === undefined ? "no member" : typeof globalThis.gc(); }
attempt(kinds);
attempt(kinds);
attempt(collect);
attempt(member);
attempt(() => gc.name);
`),
    },
  },

  "an undeclared assignment in a CommonJS package": {
    files: {
      "node_modules/leaky/package.json": JSON.stringify({ name: "leaky", version: "1.0.0", main: "index.js" }),
      "node_modules/leaky/index.js": `leakedCount = 1;
exports.start = function () { leakedCount = 10; return leakedCount; };
exports.bump = function () { leakedCount = leakedCount + 1; return leakedCount; };
exports.forget = function () { return delete leakedCount; };
exports.kind = function () { return typeof leakedCount; };
`,
      "main.mjs": javaScript(`import leaky from "leaky";
function read() { return leakedCount; }
attempt(read);
attempt(leaky.bump);
attempt(read);
attempt(() => globalThis.leakedCount);
attempt(() => JSON.stringify(Object.getOwnPropertyDescriptor(globalThis, "leakedCount")));
attempt(leaky.forget);
attempt(leaky.kind);
attempt(read);
attempt(leaky.bump);
attempt(leaky.start);
attempt(read);
attempt(leaky.bump);
`),
    },
  },

  "assigning to a missing name in strict code": { files: { "main.mjs": assignToMissingName } },
  "assigning to a missing name in sloppy code": { files: { "main.cjs": assignToMissingName } },
  "assigning to a read-only global in strict code": { files: { "main.mjs": assignToReadOnlyGlobal } },
  "assigning to a read-only global in sloppy code": { files: { "main.cjs": assignToReadOnlyGlobal } },

  "a script can't shadow a read-only global": {
    evaluatesStrings: true,
    files: {
      "main.mjs": javaScript(`import vm from "node:vm";
Object.defineProperty(globalThis, "fixed", { value: "fixed", writable: false, enumerable: true, configurable: false });
function read() { return fixed; }
attempt(read);
attempt(read);
attempt(() => vm.runInThisContext("let fixed = 'of the script';"));
attempt(read);
attempt(() => vm.runInThisContext("fixed"));
`),
    },
  },

  "typed code reads globals whose values don't match their declared types": {
    files: {
      "tsconfig.json": tsconfig,
      "main.ts": `declare var level: number;
declare var label: string;
declare var settings: { depth: number };
const world = globalThis as any;
world.level = 1;
world.label = "one";
world.settings = { depth: 1 };
function total(rounds: number): number {
  let sum = 0;
  for (let round = 0; round < rounds; round++) sum += level;
  return sum;
}
function describe(): string {
  return label + "/" + settings.depth + "/" + typeof level;
}
function show(): void {
  try {
    console.log(String(total(3)), describe());
  } catch (error) {
    console.log(error instanceof TypeError ? error.name : (error as Error).name + ": " + (error as Error).message);
  }
}
show();
show();
world.level = "text";
show();
world.level = 2.5;
world.label = 5;
show();
world.settings = { depth: "deep", more: true };
show();
world.settings = undefined;
show();
world.settings = { depth: 2 };
level = 4;
label = "stored by name";
show();
console.log(world.level, world.label);
delete world.level;
show();
export {};
`,
    },
  },
};

// `window` doesn't exist when the program starts. The programs differ only in how they define it.
const definitions: Record<string, { text: string; evaluatesStrings?: true; files?: Record<string, string> }> = {
  "an assignment": { text: `globalThis.window = made;` },
  "an assignment with a computed name": { text: `globalThis[decoded("window")] = made;` },
  "an assignment through an opaque reference": { text: `opaque(globalThis).window = made;` },
  "an undeclared assignment in a sloppy file": {
    text: `import define from "./sloppy.cjs";\ndefine(made);`,
    files: { "sloppy.cjs": `module.exports = function (value) { window = value; };\n` },
  },
  "Object.defineProperty": { text: `Object.defineProperty(globalThis, "window", { value: made, configurable: true });` },
  "Object.defineProperty with a computed name": { text: `Object.defineProperty(globalThis, decoded("window"), { value: made, configurable: true });` },
  "Object.defineProperties": { text: `Object.defineProperties(globalThis, { window: { value: made, configurable: true } });` },
  "Object.assign": { text: `Object.assign(globalThis, { window: made });` },
  "Reflect.set": { text: `Reflect.set(globalThis, "window", made);` },
  "a getter": { text: `Object.defineProperty(globalThis, "window", { get: () => made, configurable: true });` },
  "a script's var": { text: `import vm from "node:vm";\nvm.runInThisContext("var window = { mark: 'made' };");`, evaluatesStrings: true },
  "a script's let": { text: `import vm from "node:vm";\nvm.runInThisContext("let window = { mark: 'made' };");`, evaluatesStrings: true },
  "a script's let, from a string built at run time": { text: `import vm from "node:vm";\nvm.runInThisContext(decoded("let window = { mark: 'made' };"));`, evaluatesStrings: true },
  "a script's function declaration": { text: `import vm from "node:vm";\nnew vm.Script("function window() {} window.mark = 'made';").runInThisContext();`, evaluatesStrings: true },
  "var in an indirect eval": { text: `(0, eval)("var window = { mark: 'made' };");`, evaluatesStrings: true },
  "new Function": { text: `new Function("value", "globalThis.window = value;")(made);`, evaluatesStrings: true },
  "new Function, from a string built at run time": { text: `new Function("value", decoded("globalThis.window = value;"))(made);`, evaluatesStrings: true },
};

const programThatDefinesWindow = (definition: string) =>
  javaScript(`const made = { mark: "made" };
function kinds() { return [typeof window, typeof globalThis.window, "window" in globalThis].join(); }
function mark() { return typeof window === "undefined" ? "missing" : window.mark; }
function read() { return typeof window.mark; }
attempt(kinds);
attempt(kinds);
attempt(mark);
attempt(read);
${definition}
attempt(kinds);
attempt(kinds);
attempt(mark);
attempt(read);
`);

const ways: Record<string, string[]> = {
  "by default": [],
  "in a validating build": [buildFlags.validate],
  "without flow results": [buildFlags.withoutFlowResults],
  "with one global binding": [withLimit("MaxGlobalBindings", 1)],
};
// A debug or ASAN build of Bun is many times slower.
const chosen = (names: string[]) => (wanted === "quick" ? names.slice(0, 1) : names);

const entryPointsOf = (files: Record<string, string>) => Object.keys(files).filter(name => /^(main|worker)\./.test(name)).sort();

async function compile(folder: string, files: Record<string, string>, flags: string[]) {
  const executable = join(folder, "program" + (isWindows ? ".exe" : ""));
  built(await spawned([bunExe(), ...compileCommand, ...flags, ...entryPointsOf(files), "--outfile", executable], folder, bunEnv));
  return executable;
}

async function runBothWays(folder: string, executable: string, { files, evaluatesStrings, exitCode = 0 }: Program, environment: Record<string, string>) {
  const plain = await spawned([bunExe(), "run", entryPointsOf(files)[0]], folder, { ...bunEnv, ...environment });
  expect({ signal: plain.signal, exitCode: plain.exitCode, printsNothing: plain.stdout === "" }).toEqual({ signal: null, exitCode, printsNothing: false });
  const tripwire = evaluatesStrings ? {} : { [runtimeEnvironment.forbidsInterpreter]: "1" };
  const compiled = await spawned(withoutCoreDump([executable]), folder, { ...bunEnv, ...environment, ...tripwire });
  return { plain, compiled };
}

async function expectOutputOfPlainBun(program: Program, flags: string[]) {
  using dir = tempDir("aot-global-names", program.files);
  const folder = String(dir);
  const executable = await compile(folder, program.files, flags);
  for (const environment of program.environments ?? [{}]) {
    const { plain, compiled } = await runBothWays(folder, executable, program, environment);
    expect({ environment, signal: compiled.signal, ...told(compiled) }).toEqual({ environment, signal: null, ...told(plain) });
  }
}

group("compile/aot/global names", () => {
  for (const [name, program] of Object.entries(programs).filter((_, index) => index % 2 === halfOfPrograms)) {
    for (const way of chosen(Object.keys(ways))) {
      test(`${name}, ${way}`, () => slot(() => expectOutputOfPlainBun(program, ways[way])), 600_000);
    }
  }
});

group("compile/aot/global names/window is defined by", () => {
  for (const [name, { text, evaluatesStrings, files }] of Object.entries(definitions)) {
    const program: Program = { files: { "main.mjs": programThatDefinesWindow(text), ...files }, evaluatesStrings };
    for (const way of chosen(["by default", "in a validating build"])) {
      test(`${name}, ${way}`, () => slot(() => expectOutputOfPlainBun(program, ways[way])), 600_000);
    }
  }
});

// A free name is looked up among scripts' variables first. --aot rejects a script that declares the name of a global that compiled
// code treats as a constant: the script gets a SyntaxError and doesn't run. If the declaration is accepted, compiled code must see
// the variable. What must never happen: the declaration is accepted and compiled code still sees the global.
group("compile/aot/global names/a script declares the name of", () => {
  for (const name of ["Date", "Array", "Math", "process", "fetch", "URL", "navigator", "setTimeout"]) {
    const program: Program = {
      evaluatesStrings: true,
      files: {
        "main.mjs": `import vm from "node:vm";
const print = console.log;
const original = ${name};
function kind() { return typeof ${name}; }
function is(value) { return ${name} === value; }
print([kind(), is(original), is("of the script")].join());
let outcome = "declared";
try {
  vm.runInThisContext("let ${name} = 'of the script';");
} catch (error) {
  outcome = error.name;
}
print(outcome);
print([kind(), is(original), is("of the script")].join());
print(vm.runInThisContext("[typeof ${name}, ${name} === 'of the script'].join()"));
`,
      },
    };
    for (const way of chosen(["by default", "in a validating build", "without flow results"])) {
      test(
        `${name}, ${way}`,
        () =>
          slot(async () => {
            using dir = tempDir("aot-global-names-declared-by-a-script", program.files);
            const folder = String(dir);
            const { plain, compiled } = await runBothWays(folder, await compile(folder, program.files, ways[way]), program, {});
            const [before, outcome, inCompiledCode, inALaterScript] = compiled.stdout.split("\n");
            if (outcome === "declared") return void expect({ signal: compiled.signal, ...told(compiled) }).toEqual({ signal: null, ...told(plain) });
            expect({ signal: compiled.signal, exitCode: compiled.exitCode, before, outcome, inCompiledCode, inALaterScript }).toEqual({
              signal: null,
              exitCode: 0,
              before: plain.stdout.split("\n")[0],
              outcome: "SyntaxError",
              inCompiledCode: before,
              inALaterScript: before.split(",")[0] + ",false",
            });
          }),
        600_000,
      );
    }
  }
});

// Without per-site caches, an access that is still by name calls the run time every time. A name resolved at build time or through
// its record calls it only until the record is filled.
type Measured = { setup?: string; body: string; callsTheRunTime: "only at startup" | "every round"; evaluatesStrings?: true };
const measured: Record<string, Measured> = {
  "a global the program sets once": { setup: `globalThis.made = 3;`, body: `sum += made;`, callsTheRunTime: "only at startup" },
  "a global assigned by name every round": { setup: `globalThis.tally = 0;`, body: `tally = tally + 1; sum += tally;`, callsTheRunTime: "only at startup" },
  "a script's let": { setup: `vm.runInThisContext("let scripted = 2;");`, body: `sum += scripted;`, callsTheRunTime: "only at startup", evaluatesStrings: true },
  "a script's const": { setup: `vm.runInThisContext("const scripted = 4;");`, body: `sum += scripted;`, callsTheRunTime: "only at startup", evaluatesStrings: true },
  "typeof of missing names in a program that evaluates no strings": { body: `if (typeof window === "undefined") sum++; if (typeof document !== "undefined") sum--;`, callsTheRunTime: "only at startup" },
  "a missing member of globalThis in a program that evaluates no strings": { body: `if (globalThis.nope === undefined) sum++;`, callsTheRunTime: "only at startup" },
  "typeof of a missing name that a script could declare": { setup: `vm.runInThisContext("0");`, body: `if (typeof window === "undefined") sum++;`, callsTheRunTime: "only at startup", evaluatesStrings: true },
  "a missing member of globalThis that a script could define": { setup: `vm.runInThisContext("0");`, body: `if (globalThis.nope === undefined) sum++;`, callsTheRunTime: "only at startup", evaluatesStrings: true },
  "typeof of a global that a script could replace": { setup: `vm.runInThisContext("0");`, body: `if (typeof setTimeout === "function") sum++; if (typeof process === "object") sum++;`, callsTheRunTime: "only at startup", evaluatesStrings: true },
  "a global that is a getter": { setup: `Object.defineProperty(globalThis, "computed", { get() { return 1; }, configurable: true });`, body: `sum += computed;`, callsTheRunTime: "every round" },
};
const rounds = { few: 500, many: 2500 };

group("compile/aot/global names/run-time calls", () => {
  for (const [name, { setup = "", body, callsTheRunTime, evaluatesStrings }] of Object.entries(measured)) {
    // ./supported-with-counted-calls.ts says why nothing is counted on Windows.
    test.skipIf(isWindows)(
      `${name}: ${callsTheRunTime}`,
      () =>
        slot(async () => {
          const files = {
            "main.mjs": `${evaluatesStrings ? `import vm from "node:vm";` : ""}
${setup}
function run(rounds) {
  let sum = 0;
  for (let round = 0; round < rounds; round++) {
    ${body}
  }
  return sum;
}
console.log(run(Number(process.argv[2])));
`,
          };
          using dir = tempDir("aot-global-names-measured", files);
          const folder = String(dir);
          const executable = await compile(folder, files, [withLimit("MaxSiteCaches", 0)]);
          const count = async (roundCount: number) => {
            const plain = await spawned([bunExe(), "run", "main.mjs", String(roundCount)], folder, bunEnv);
            const path = join(folder, "counts-" + roundCount);
            const compiled = await spawned(withoutCoreDump([executable, String(roundCount)]), folder, { ...bunEnv, [runtimeEnvironment.countsPath]: path });
            expect({ signal: compiled.signal, ...told(compiled) }).toEqual({ signal: null, stdout: plain.stdout, stderr: "", exitCode: 0 });
            const lines = readFileSync(path, "utf8").split("\n").map(line => line.split("\t"));
            return new Map(lines.filter(([, what]) => what?.startsWith("operation:")).map(([calls, what]) => [what, Number(calls)] as const));
          };
          const few = await count(rounds.few);
          const many = await count(rounds.many);
          expect(few.size).toBeGreaterThan(0);
          const callsPerRound = [...many].map(([operation, calls]) => [operation, (calls - (few.get(operation) ?? 0)) / (rounds.many - rounds.few)] as const);
          const growing = Object.fromEntries(callsPerRound.filter(([, perRound]) => perRound > 0.1));
          if (callsTheRunTime === "only at startup") expect(growing).toEqual({});
          else expect(Math.max(0, ...Object.values(growing))).toBeGreaterThanOrEqual(0.9);
        }),
      600_000,
    );
  }
});

/** The first group has two test files, global-names-<part>.test.ts, and the other three have one together: a test is a build, and a file has five minutes. */
export function globalNames(part: number) {
  halfOfPrograms = part === 2 ? 1 : 0;
  for (const [name, body] of part === 3 ? groups.slice(1) : groups.slice(0, 1)) describe.concurrent(name, body);
}
