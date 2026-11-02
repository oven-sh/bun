// Every way in which JavaScript that isn't in the executable could start inside it, one small program each. The whole-program analysis of --aot assumes that it
// has seen all the code that will ever run: either the build finds that the program can run other code (the report lists an event under `unseenCode`, and nothing
// is proven about what that code can reach), or the attempt throws at run time. A route that runs the code in an executable whose build found no event fails here.
// An evaluator is followed as a value: the event is raised where it is called, and where the compiler loses track of it. One that is read off a value the compiler
// knows nothing about raises no event, and its call throws before any string is evaluated.
// The strings and the paths are put together at run time, so the build can't know them.
// A Worker that starts from text runs it in a VM of its own, without the compiled program: nothing that the analysis has proven is within its reach. Its routes are listed to pin that they run.
// Machine code is not such JavaScript: an N-API addon and what bun:ffi calls are native code like Bun's own. Their routes are listed to pin that they raise no event and are not refused.
// What native code can do to a compiled program is the subject of native-addons.test.ts.
import { afterAll, expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "path";
import { slot, spawned } from "./harness/commands";
import { beforeAll, describe, test } from "./supported";

type Route = {
  body: string;
  extension?: "js" | "cjs" | "mjs";
  /** Milliseconds the program waits before it looks whether the code ran. */
  wait?: number;
  /** "{FILE}" stands for a file outside the executable that sets globalThis.RAN. */
  env?: Record<string, string>;
  args?: string[];
  filesInWorkingDirectory?: Record<string, string>;
  /** The executable runs as plain Bun and the compiled program does not start. */
  replacesTheProgram?: boolean;
  /** It loads or calls machine code and runs no JavaScript from outside. */
  isMachineCode?: boolean;
  /** The code runs in a Worker that holds nothing of the compiled program: no object of the program is within its reach, so the build has no event to raise. */
  runsApartFromTheProgram?: boolean;
};

const helpers = (wait: number) => `
const never = process.argv.length > 99;
const glue = (...parts) => parts.join(never ? "x" : "");
const text = glue("globalThis.RAN", " = (globalThis.RAN || 0)", " + 1; 'value'");
const moduleText = glue("globalThis.RAN", " = (globalThis.RAN || 0)", " + 1;");
function temporaryFile(extension, contents) { const fs = require("node:fs"), os = require("node:os"), path = require("node:path"); const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "unseen-")), glue("code", extension)); fs.writeFileSync(file, contents); return file; }
async function attempt(f) { let error; try { await f(); await new Promise(r => setTimeout(r, ${wait})); } catch (e) { error = e ?? new Error("threw " + e); } console.log(globalThis.RAN ? "RAN" : error ? "refused " + error.name + (error.code ? " " + error.code : "") : "did not run"); }
`;
/** A program holds the helpers that it uses and no others: what they import would be compiled with it. */
const prelude = ({ body, wait = 0 }: Route) =>
  helpers(wait)
    .split("\n")
    .filter(line => {
      const name = /^(?:const|function|async function) (\w+)/.exec(line)?.[1];
      return !name || ["never", "glue", "attempt"].includes(name) || new RegExp(`\\b${name}\\b`).test(body);
    })
    .join("\n");

const vm = `const vm = require(glue('node:', 'vm')); const o = { n: 1 }; `;
const changed = `; if (o.n !== 1) globalThis.RAN = 1`;

const routes: Record<string, Record<string, Route>> = {
  "evaluators": {
    "eval direct": { body: `eval(text)` },
    "eval indirect": { body: `(0, eval)(text)` },
    "eval through a variable": { body: `const e = eval; e(text)` },
    "eval under a computed name": { body: `globalThis[glue('ev', 'al')](text)` },
    "eval as a callback of map": { body: `[text].map(eval)` },
    "eval as a promise reaction": { body: `await Promise.resolve(text).then(eval)` },
    "eval through a proxy": { body: `new Proxy(eval, {})(text)` },
    "eval from a descriptor": { body: `Object.getOwnPropertyDescriptor(globalThis, glue('ev', 'al')).value(text)` },
    "function constructor": { body: `new Function(text)()` },
    "function constructor of a function": { body: `(function () {}).constructor(text)()` },
    "function constructor through a built in method": { body: `[].map.constructor(text)()` },
    "function constructor under a computed name": { body: `globalThis[glue('Func', 'tion')](text)()` },
    "function constructor under a computed member": { body: `(function () {})[glue('const', 'ructor')](text)()` },
    "function constructor through reflect construct": { body: `Reflect.construct(Function, [text])()` },
    "function constructor bound": { body: `Function.bind(null, text)()()` },
    "function constructor subclass": { body: `new (class extends Function {})(text)()` },
    "function constructor of unknown value": { body: `JSON.parse('[]').constructor.constructor(text)()` },
    "async function constructor": { body: `await Object.getPrototypeOf(async function () {}).constructor(text)()` },
    "generator function constructor": { body: `Object.getPrototypeOf(function* () {}).constructor(text)().next()` },
    "timeout with a string": { body: `setTimeout(text, 0)`, wait: 30 },
    "immediate with a string": { body: `setImmediate(text)`, wait: 30 },
  },
  "node:module": {
    "module compile": {
      body: `const Module = require('node:module'); const m = new Module('/x.js'); m._compile(moduleText, '/x.js')`,
    },
    "module compile of own module": { body: `module._compile(moduleText, '/x.js')`, extension: "cjs" },
    "module compile through constructor": {
      body: `new module.constructor('/x.js')._compile(moduleText, '/x.js')`,
      extension: "cjs",
    },
    "module load": { body: `require('node:module')._load(temporaryFile('.js', moduleText))` },
    "module extensions": {
      body: `const Module = require('node:module'); const f = temporaryFile('.js', moduleText); Module._extensions['.js'](new Module(f), f)`,
    },
    "module prototype load": {
      body: `const Module = require('node:module'); const f = temporaryFile('.js', moduleText); new Module(f).load(f)`,
    },
    "module create require": { body: `require('node:module').createRequire('/')(temporaryFile('.js', moduleText))` },
    "module run main": {
      body: `const f = temporaryFile('.js', moduleText); process.argv[1] = f; require('node:module').runMain(f)`,
    },
    "module register": {
      body: `require('node:module').register(require('node:url').pathToFileURL(temporaryFile('.mjs', moduleText)).href)`,
      wait: 30,
    },
    "module require method": { body: `module.require(temporaryFile('.js', moduleText))`, extension: "cjs" },
    "own extension handler compiles": {
      body: `require.extensions[glue('.unse', 'en')] = (m, f) => m._compile(require('node:fs').readFileSync(f, 'utf8'), f); require(temporaryFile('.unseen', moduleText))`,
      extension: "cjs",
    },
    "module load of vm": { body: `require('node:module')._load(glue('v', 'm')).runInThisContext(text)` },
    "create require of vm": {
      body: `require('node:module').createRequire('/')(glue('v', 'm')).runInThisContext(text)`,
    },
  },
  "loaders with names nobody knows": {
    "require of a file": { body: `require(temporaryFile('.js', moduleText))` },
    "require after resolve sync": {
      body: `const f = temporaryFile('.js', moduleText); require(Bun.resolveSync(f, '/'))`,
    },
    "import meta require": { body: `import.meta.require(temporaryFile('.js', moduleText))`, extension: "mjs" },
    "import of a file": { body: `await import(temporaryFile('.mjs', moduleText))` },
    "import of a data url": { body: `await import(glue('data:text/javascript,', encodeURIComponent(moduleText)))` },
    "import of a blob url": {
      body: `await import(URL.createObjectURL(new Blob([moduleText], { type: 'text/javascript' })))`,
    },
    "import of an http url": {
      body: `const s = Bun.serve({ port: 0, fetch: () => new Response(moduleText, { headers: { 'content-type': 'text/javascript' } }) }); try { await import(glue('http://127.0.0.1:', s.port, '/x.js')); } finally { s.stop(true); }`,
    },
    "require of vm under a computed name": { body: `require(glue('v', 'm')).runInThisContext(text)` },
    "require of node vm under a computed name": { body: `require(glue('node:', 'vm')).runInThisContext(text)` },
    "import of vm under a computed name": { body: `(await import(glue('node:', 'vm'))).runInThisContext(text)` },
    "vm named": { body: `require('node:vm').runInThisContext(text)` },
    "vm compile function": { body: `require('node:vm').compileFunction(text)()` },
  },
  "process": {
    "process get builtin module vm": { body: `process.getBuiltinModule(glue('v', 'm')).runInThisContext(text)` },
    "process get builtin module module": {
      body: `process.getBuiltinModule(glue('mod', 'ule'))._load(temporaryFile('.js', moduleText))`,
    },
    "process binding contextify": { body: `process.binding(glue('context', 'ify'))` },
    "process binding natives": { body: `Object.keys(process.binding(glue('nat', 'ives'))).length` },
    "process linked binding": { body: `process._linkedBinding(glue('context', 'ify'))` },
    "process dlopen": {
      body: `process.dlopen({ exports: {} }, temporaryFile('.node', 'not a library'))`,
      isMachineCode: true,
    },
    "require of an addon": { body: `require(temporaryFile('.node', 'not a library'))` },
  },
  "workers": {
    "worker of a file": {
      body: `const w = new Worker(temporaryFile('.js', glue('postMessage(', '1)'))); await new Promise((res, rej) => { w.onmessage = () => { globalThis.RAN = 1; res(); }; w.onerror = e => rej(new Error(e.message)); setTimeout(() => rej(new Error('no message')), 1500); }).finally(() => w.terminate())`,
    },
    "worker of a blob url": {
      runsApartFromTheProgram: true,
      body: `const w = new Worker(URL.createObjectURL(new Blob([glue('postMessage(', '1)')], { type: 'text/javascript' }))); await new Promise((res, rej) => { w.onmessage = () => { globalThis.RAN = 1; res(); }; w.onerror = e => rej(new Error(e.message)); setTimeout(() => rej(new Error('no message')), 1500); }).finally(() => w.terminate())`,
    },
    "worker of a data url": {
      runsApartFromTheProgram: true,
      body: `const w = new Worker(glue('data:text/javascript,', 'postMessage(1)')); await new Promise((res, rej) => { w.onmessage = () => { globalThis.RAN = 1; res(); }; w.onerror = e => rej(new Error(e.message)); setTimeout(() => rej(new Error('no message')), 1500); }).finally(() => w.terminate())`,
    },
    "worker threads eval": {
      runsApartFromTheProgram: true,
      body: `const { Worker } = require('node:worker_threads'); const w = new Worker(glue('require("node:worker_threads").parentPort.postMessage(', '1)'), { eval: true }); await new Promise((res, rej) => { w.on('message', () => { globalThis.RAN = 1; res(); }); w.on('error', rej); setTimeout(() => rej(new Error('no message')), 1500); }).finally(() => w.terminate())`,
    },
    "worker with preload": {
      body: `const w = new Worker(temporaryFile('.js', ''), { preload: [temporaryFile('.js', glue('postMessage(', '1)'))] }); await new Promise((res, rej) => { w.onmessage = () => { globalThis.RAN = 1; res(); }; w.onerror = e => rej(new Error(e.message)); setTimeout(() => rej(new Error('no message')), 1500); }).finally(() => w.terminate())`,
    },
  },
  "Bun's own APIs": {
    "plugin on load returns text": {
      body: `Bun.plugin({ name: 'p', setup(b) { b.onResolve({ filter: /^virtual:/ }, a => ({ path: a.path, namespace: 'v' })); b.onLoad({ filter: /.*/, namespace: 'v' }, () => ({ contents: moduleText, loader: 'js' })); } }); await import(glue('virtual:', 'x'))`,
    },
    "plugin module returns text": {
      body: `Bun.plugin({ name: 'p', setup(b) { b.module(glue('virtual-', 'module'), () => ({ contents: moduleText, loader: 'js' })); } }); await import(glue('virtual-', 'module'))`,
    },
    "plugin on resolve returns a file": {
      body: `const f = temporaryFile('.mjs', moduleText); Bun.plugin({ name: 'p', setup(b) { b.onResolve({ filter: /^outside$/ }, () => ({ path: f })); } }); await import(glue('out', 'side'))`,
    },
    "build then import": {
      body: `const f = temporaryFile('.js', moduleText); const o = await Bun.build({ entrypoints: [f], outdir: require('node:path').dirname(f) + '/out' }); await import(o.outputs[0].path)`,
    },
    "transpiler then function": { body: `Function(new Bun.Transpiler({ loader: 'ts' }).transformSync(text))()` },
    "bun ffi property": {
      body: `typeof Bun.FFI.dlopen === 'function' && Bun.FFI.dlopen(temporaryFile('.so', 'x'), {})`,
      isMachineCode: true,
    },
    "bun ffi named": { body: `require('bun:ffi').dlopen(temporaryFile('.so', 'x'), {})`, isMachineCode: true },
    "bun ffi cc": {
      body: `const library = require('bun:ffi').cc({ source: temporaryFile('.c', 'int f(void) { return 1; }'), symbols: { f: { returns: 'int', args: [] } } }); try { library.symbols.f() === 1 && (globalThis.RAN = 1); } finally { library.close(); }`,
      isMachineCode: true,
    },
    "bun jsc under a computed name": { body: `Object.keys(require(glue('bun:', 'jsc'))).length` },
    "sqlite load extension": {
      body: `new (require('bun:sqlite').Database)(':memory:').loadExtension(temporaryFile('.so', 'x'))`,
    },
    "inspector named": { body: `require('node:inspector').open(0)` },
    "inspector under a computed name": { body: `require(glue('node:', 'inspector')).open(0)` },
    "node test under a computed name": { body: `typeof require(glue('node:', 'test'))` },
    "html rewriter then eval": {
      body: `let got = ''; new HTMLRewriter().on('script', { text(t) { got += t.text; } }).transform(glue('<script>', text, '</script>')); (0, eval)(got)`,
    },
  },
  "what is given to the executable from outside": {
    "preload in bun options": { body: `0`, env: { "BUN_OPTIONS": "--preload {FILE}" } },
    "require in node options": { body: `0`, env: { "NODE_OPTIONS": "--require {FILE}" } },
    "preload argument": { body: `0`, args: ["--preload", "{FILE}"] },
    "require argument": { body: `0`, args: ["-r", "{FILE}"] },
    "eval argument": { body: `0`, args: ["-e", "globalThis.RAN = 1; console.log('eval-argument: RAN')"] },
    "preload in bunfig": { body: `0`, filesInWorkingDirectory: { "bunfig.toml": 'preload = ["{FILE}"]\n' } },
    "inspect in environment": { body: `0`, env: { "BUN_INSPECT": "ws://127.0.0.1:0/x" } },
    "inspect argument": { body: `0`, args: ["--inspect=127.0.0.1:0"] },
    "be bun in environment": { body: `0`, env: { "BUN_BE_BUN": "1" }, args: ["{FILE}"], replacesTheProgram: true },
  },
  "evaluators of node:vm reached without naming the module, with objects of the program handed in": {
    "unnamed vm run in new context": { body: vm + `vm.runInNewContext(glue('o.n', ' = 2'), { o })` + changed },
    "unnamed vm script in this context": {
      body: vm + `globalThis.o = o; new vm.Script(glue('o.n', ' = 2')).runInThisContext()` + changed,
    },
    "unnamed vm source text module": {
      body:
        vm +
        `const m = new vm.SourceTextModule(glue('globalThis.RAN', ' = 1')); await m.link(() => {}); await m.evaluate()`,
    },
    "unnamed vm function of new context": {
      body: vm + `vm.runInNewContext(glue('Func', 'tion'))(glue('o', ''), glue('o.n', ' = 2'))(o)` + changed,
    },
    "builtin module vm run in new context": {
      body:
        `const vm = process.getBuiltinModule(glue('v', 'm')); const o = { n: 1 }; vm.runInNewContext(glue('o.n', ' = 2'), { o })` +
        changed,
    },
  },
  "the module loader object": {
    "loader object exists": {
      body: `typeof Loader === 'object' && Object.getOwnPropertyNames(Object.getPrototypeOf(Loader)).length`,
    },
    "loader parse module": {
      body: `const k = glue('unseen:', 'x'); const m = await Loader.parseModule(k, moduleText); globalThis.PARSED = m`,
    },
    "loader provide fetch": {
      body: `const k = glue('unseen:', 'x'); Loader.provideFetch(k, moduleText); await Loader.loadAndEvaluateModule(k)`,
    },
    "loader load and evaluate file": { body: `await Loader.loadAndEvaluateModule(temporaryFile('.mjs', moduleText))` },
    "loader request import": { body: `await Loader.requestImportModule(temporaryFile('.mjs', moduleText))` },
    "loader registry hands out modules": {
      body: `let n = 0; for (const [k] of Loader.registry) n++; if (n) console.log('registry entries', n)`,
    },
  },
  "flagged modules and members reached under names nobody knows": {
    "unnamed ffi dlopen": {
      body: `const ffi = require(glue('bun:', 'ffi')); const lib = ffi.dlopen(glue('libc.so', '.6'), { getpid: { args: [], returns: 'int' } }); if (lib.symbols.getpid() > 0) globalThis.RAN = 1`,
    },
    "unnamed ffi raw memory": {
      body: `const ffi = require(glue('bun:', 'ffi')); const a = new Uint8Array(8); const p = ffi.ptr(a); new Uint8Array(ffi.toArrayBuffer(p, 0, 8))[0] = 7; if (a[0] === 7) globalThis.RAN = 1`,
    },
    "builtin module ffi": {
      body: `const ffi = process.getBuiltinModule(glue('bun:', 'ffi')); const lib = ffi.dlopen(glue('libc.so', '.6'), { getpid: { args: [], returns: 'int' } }); if (lib.symbols.getpid() > 0) globalThis.RAN = 1`,
    },
    "unnamed worker threads eval": {
      runsApartFromTheProgram: true,
      body: `const { Worker } = require(glue('node:', 'worker_threads')); const w = new Worker(glue('require("node:worker_threads").parentPort.postMessage(', '1)'), { eval: true }); await new Promise((res, rej) => { w.on('message', () => { globalThis.RAN = 1; res(); }); w.on('error', rej); setTimeout(() => rej(new Error('no message')), 1500); }).finally(() => w.terminate())`,
    },
    "unnamed repl": { body: `typeof require(glue('node:', 'repl')).start` },
    "plugin under a computed name": {
      body: `Bun[glue('plu', 'gin')]({ name: 'p', setup(b) { b.module(glue('virtual-', 'module'), () => ({ contents: moduleText, loader: 'js' })); } }); await import(glue('virtual-', 'module'))`,
    },
    "worker under a computed name": {
      body: `const w = new globalThis[glue('Wor', 'ker')](temporaryFile('.js', glue('postMessage(', '1)'))); await new Promise((res, rej) => { w.onmessage = () => { globalThis.RAN = 1; res(); }; w.onerror = e => rej(new Error(e.message)); setTimeout(() => rej(new Error('no message')), 1500); }).finally(() => w.terminate())`,
    },
    "module compile under a computed name": {
      body: `const Module = require(glue('node:', 'module')); new Module('/x.js')[glue('_com', 'pile')](moduleText, '/x.js')`,
    },
    "spawn of itself as bun": {
      body: `const p = Bun.spawnSync([process.execPath, '-e', glue('console.log(', '"CHILD")')], { env: { ...process.env, BUN_BE_BUN: '1' } }); if (p.stdout.toString().includes('CHILD')) console.log('a child process ran as plain Bun')`,
    },
  },
  "objects that never escaped handed out by native code": {
    "call site get function": {
      body: `function hidden() { return new Error('x').stack; } const old = Error.prepareStackTrace; let got; Error.prepareStackTrace = (e, frames) => { got = frames.map(f => typeof f.getFunction()); return ''; }; hidden(); Error.prepareStackTrace = old; console.log('getFunction gives', got.slice(0, 2).join())`,
      extension: "cjs",
    },
    "call site get this": {
      body: `const secret = { n: 1, m() { return new Error('x').stack; } }; const old = Error.prepareStackTrace; let got; Error.prepareStackTrace = (e, frames) => { got = frames.map(f => f.getThis()); return ''; }; secret.m(); Error.prepareStackTrace = old; if (got[0] === secret) { got[0].n = 's'; console.log('getThis gives the receiver', typeof secret.n); } else console.log('getThis gives', typeof got[0])`,
      extension: "cjs",
    },
    "function caller": {
      body: `function inner() { return inner.caller; } function outer() { return inner(); } console.log('caller gives', typeof outer(), outer() === outer)`,
      extension: "cjs",
    },
    "arguments callee caller": {
      body: `function inner() { return arguments.callee.caller; } function outer() { return inner(); } console.log('callee.caller gives', typeof outer())`,
      extension: "cjs",
    },
    "function arguments": {
      body: `function inner() { return outer.arguments; } function outer(o) { return inner(); } const o = { n: 1 }; const a = outer(o); console.log('f.arguments gives', a && a[0] === o)`,
      extension: "cjs",
    },
  },
  "what Bun's own library does on the application's behalf": {
    "addon extension handler": {
      body: `require('node:module')._extensions['.node']({ exports: {} }, temporaryFile('.node', 'not a library'))`,
    },
    "addon extension handler under a computed name": {
      body: `require('node:module')._extensions[glue('.no', 'de')]({ exports: {} }, temporaryFile('.node', 'not a library'))`,
    },
    "serve static plugins in bunfig": {
      body: `const page = require('./page.html'); const s = Bun.serve({ port: 0, routes: { '/': page.default ?? page } }); try { await (await fetch(s.url)).text(); } finally { s.stop(true); }`,
      wait: 50,
      filesInWorkingDirectory: { "bunfig.toml": '[serve.static]\nplugins = ["{FILE}"]\n' },
    },
    "serve development with plugins in bunfig": {
      body: `const page = require('./page.html'); const s = Bun.serve({ port: 0, development: true, routes: { '/': page.default ?? page } }); try { await (await fetch(s.url)).text(); } finally { s.stop(true); }`,
      wait: 50,
      filesInWorkingDirectory: { "bunfig.toml": '[serve.static]\nplugins = ["{FILE}"]\n' },
    },
    "build with a macro": {
      body: `const f = temporaryFile('.ts', glue('import { m } from "./macro.ts" with { type: "macro" }; console.log(m());')); require('node:fs').writeFileSync(require('node:path').dirname(f) + '/macro.ts', glue('export function m() { require("node:fs").writeFileSync(', JSON.stringify(require('node:path').dirname(f) + '/ran'), ', "1"); return 1; }')); await Bun.build({ entrypoints: [f] }); if (require('node:fs').existsSync(require('node:path').dirname(f) + '/ran')) globalThis.RAN = 1`,
    },
    "transpiler with a macro": {
      body: `const f = temporaryFile('.ts', glue('export function m() { globalThis.RAN', ' = 1; return 1; }')); new Bun.Transpiler({ loader: 'ts', macro: {} }).transformSync(glue('import { m } from ', JSON.stringify(f), ' with { type: "macro" }; m();'))`,
    },
    "transpiler with a macro out of a built-in module": {
      body: `new Bun.Transpiler({ loader: 'ts' }).transformSync(glue('import { runInThisContext as m } from "node:vm" with { type: "macro" }; m(', JSON.stringify(text), ');'))`,
    },
    "transpiler that scans a text with a macro": {
      body: `new Bun.Transpiler({ loader: 'ts' }).scan(glue('import { runInThisContext as m } from "node:vm" with { type: "macro" }; m(', JSON.stringify(text), ');'))`,
    },
    "build plugin from a file": {
      body: `const f = temporaryFile('.js', moduleText); await Bun.build({ entrypoints: [f], plugins: [require(f)] })`,
    },
  },
};

// One build for each route would be a hundred builds. The routes are files of two programs, whose entry points import the file that ROUTE names, and the report says in which file each event lies.
// In the first program are the routes for which the build finds an event: each opens the program to unseen code by itself. In the second are those for which it finds none, so that program stays
// closed, and a route in it that runs the code fails.
const findsNoEvent = new Set([
  "addon extension handler",
  "addon extension handler under a computed name",
  "arguments callee caller",
  "be bun in environment",
  "call site get function",
  "call site get this",
  "eval argument",
  "eval from a descriptor",
  "eval under a computed name",
  "function arguments",
  "function caller",
  "function constructor under a computed member",
  "function constructor under a computed name",
  "immediate with a string",
  "inspect argument",
  "inspect in environment",
  "inspector named",
  "loader load and evaluate file",
  "loader object exists",
  "loader parse module",
  "loader provide fetch",
  "loader registry hands out modules",
  "loader request import",
  "module compile through constructor",
  "module extensions",
  "module prototype load",
  "module register",
  "module run main",
  "preload argument",
  "preload in bun options",
  "preload in bunfig",
  "process binding contextify",
  "process binding natives",
  "process linked binding",
  "require argument",
  "require in node options",
  "serve development with plugins in bunfig",
  "serve static plugins in bunfig",
  "spawn of itself as bun",
  "sqlite load extension",
  "timeout with a string",
  "transpiler that scans a text with a macro",
  "transpiler with a macro",
  "transpiler with a macro out of a built-in module",
  "worker of a blob url",
  "worker of a data url",
  "worker of a file",
  "worker threads eval",
  "worker under a computed name",
  "worker with preload",
]);

// The event of these lies in a built-in module or nowhere, so only a program of their own tells whose it is.
const builtAlone = new Set([
  "eval as a callback of map",
  "eval as a promise reaction",
  "function constructor through reflect construct",
  "function constructor bound",
  "vm named",
  "bun ffi named",
  "bun ffi cc",
]);

type Event = { location: { file: string } | null };
const all = Object.entries(routes).flatMap(([group, members]) =>
  Object.entries(members).map(([name, route]) => ({
    group,
    name,
    route,
    file: `${name.replaceAll(" ", "-")}.${route.extension ?? "js"}`,
  })),
);
const textOf = (route: Route) =>
  (route.extension === "mjs"
    ? `import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);\n`
    : "") + `${prelude(route)}attempt(async () => { ${route.body}; });\n`;
const others = {
  "page.html": "<!doctype html><title>t</title><p>page</p>",
  "outside.js": `globalThis.RAN = 1; console.log("RAN");\n`,
  "run/empty.txt": "",
};

async function build(folder: string, main: string) {
  const executable = join(folder, isWindows ? "program.exe" : "program");
  const report = join(folder, "report.json");
  const built = await spawned(
    [bunExe(), "build", "--compile", "--aot", "--aot-report=" + report, main, "--outfile", executable],
    folder,
    bunEnv,
  );
  expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
  return { executable, events: JSON.parse(readFileSync(report, "utf8")).unseenCode as Event[] };
}

async function judge(
  folder: string,
  executable: string,
  sawAnEvent: boolean,
  route: Route,
  more: Record<string, string> = {},
) {
  const outside = join(folder, "outside.js");
  const withFile = (text: string) => text.replaceAll("{FILE}", isWindows ? outside.replaceAll("\\", "/") : outside);
  const workingDirectory = join(folder, "run");
  for (const [file, text] of Object.entries(route.filesInWorkingDirectory ?? {}))
    await Bun.write(join(workingDirectory, file), withFile(text));
  const env = {
    ...bunEnv,
    ...more,
    ...Object.fromEntries(Object.entries(route.env ?? {}).map(([key, value]) => [key, withFile(value)])),
  };
  const ran = await spawned([executable, ...(route.args ?? []).map(withFile)], workingDirectory, env);
  expect(ran.signal).toBeNull();
  if (route.isMachineCode) {
    // The build says that machine code may be loaded, and the load is not refused. Whether the library or the C compiler is there depends on the machine.
    const isRefusedAsUnseenCode = /^refused Error ERR_CODE_NOT_COMPILED$/m.test(ran.stdout);
    return void expect({ sawAnEvent, isRefusedAsUnseenCode, stdout: ran.stdout }).toEqual({
      sawAnEvent: true,
      isRefusedAsUnseenCode: false,
      stdout: expect.any(String),
    });
  }
  const ranTheCode = /^RAN$/m.test(ran.stdout);
  if (route.runsApartFromTheProgram)
    return void expect({ ranTheCode, stdout: ran.stdout }).toEqual({ ranTheCode: true, stdout: expect.any(String) });
  expect({ ranTheCode: ranTheCode && !sawAnEvent && !route.replacesTheProgram, stdout: ran.stdout }).toEqual({
    ranTheCode: false,
    stdout: expect.any(String),
  });
}

export function codeTheCompilerNeverSaw() {
  describe.concurrent("code the compiler never saw, in a program of its own", () => {
    for (const { group, name, route, file } of all.filter(({ name }) => builtAlone.has(name))) {
      test(
        `${group}: ${name}`,
        () =>
          slot(async () => {
            using dir = tempDir("aot-unseen-code", { [file]: textOf(route), ...others });
            const { executable, events } = await build(String(dir), file);
            await judge(String(dir), executable, events.length > 0, route);
          }),
        600_000,
      );
    }
  });

  for (const [title, routesOfProgram] of [
    [
      "in a program that the build finds open",
      all.filter(({ name }) => !findsNoEvent.has(name) && !builtAlone.has(name)),
    ],
    ["in a program that the build finds closed", all.filter(({ name }) => findsNoEvent.has(name))],
  ] as const) {
    describe(`code the compiler never saw, ${title}`, () => {
      const dir = tempDir("aot-unseen-code", {
        "main.js":
          `const routes = {\n${routesOfProgram.map(({ file }) => `  ${JSON.stringify(file)}: () => import("./${file}"),\n`).join("")}};\n` +
          `routes[process.env.ROUTE]();\n`,
        ...Object.fromEntries(routesOfProgram.map(({ file, route }) => [file, textOf(route)])),
        ...others,
      });
      afterAll(() => dir[Symbol.dispose]());
      let built: Awaited<ReturnType<typeof build>>;
      beforeAll(async () => void (built = await build(String(dir), "main.js")), 600_000);
      for (const { group, name, route, file } of routesOfProgram) {
        test.concurrent(
          `${group}: ${name}`,
          () =>
            slot(async () => {
              using run = tempDir("aot-unseen-code-run", others);
              const sawAnEvent = built.events.some(event => event.location?.file.replaceAll("\\", "/").endsWith(file));
              expect({ sawAnEvent }).toEqual({ sawAnEvent: !findsNoEvent.has(name) });
              await judge(String(run), built.executable, sawAnEvent, route, { ROUTE: file });
            }),
          600_000,
        );
      }
    });
  }
}
