// Every way in which JavaScript that isn't in the executable could start inside it, one small program each. The whole-program analysis of --aot assumes that it
// has seen all the code that will ever run: either the build finds that the program can run other code (`--explain=trim` prints a line for the event, and nothing
// is proven about what that code can reach), or the attempt throws at run time. A route that runs the code in an executable whose build found no event fails here.
// Each route says what its program prints, and is held to that too.
// An evaluator is followed as a value: the event is raised where it is called, and where the compiler loses track of it. One that is read off a value the compiler
// knows nothing about raises no event, and its call throws before any string is evaluated.
// The strings and the paths are put together at run time, so the build can't know them.
// A Worker that starts from text runs it in a VM of its own, without the compiled program: nothing that the analysis has proven is within its reach. Its routes are listed to pin that they run.
// Machine code is not such JavaScript: an N-API addon and what bun:ffi calls are native code like Bun's own. Their routes are listed to pin that they raise no event and are not refused.
// What native code can do to a compiled program is the subject of native-addons.test.ts.
import { afterAll, expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isGlibc, isWindows, tempDir } from "harness";
import { join } from "path";
import { canTrim } from "../bundler/compile-trim-features";
import { built, slot, spawned } from "./harness/commands";
import { describe, test } from "./supported";

type Route = {
  body: string;
  /**
   * What the program prints, without the end of its last line: "RAN" where the code ran, "refused" with the name and the code of the error where the attempt threw,
   * "did not run" where neither happened. Left out where it depends on the machine.
   */
  prints?: string;
  /** What the executable writes to stderr, where it is not silent: all of it, or a pattern for a part of it. */
  stderr?: string | RegExp;
  /** What the executable ends with, where that is not 0. */
  exitCode?: number;
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

// A Bun that can trim leaves its command line out of every executable that it compiles ahead of time: executables-leave-out-the-command-line.test.ts.
const leavesOutTheCommandLine = canTrim;

const vm = `const vm = require(glue('node:', 'vm')); const o = { n: 1 }; `;
const changed = `; if (o.n !== 1) globalThis.RAN = 1`;

const routes: Record<string, Record<string, Route>> = {
  "evaluators": {
    "eval direct": { body: `eval(text)`, prints: "RAN" },
    "eval indirect": { body: `(0, eval)(text)`, prints: "RAN" },
    "eval through a variable": { body: `const e = eval; e(text)`, prints: "RAN" },
    "eval under a computed name": { body: `globalThis[glue('ev', 'al')](text)`, prints: "RAN" },
    "eval as a callback of map": { body: `[text].map(eval)`, prints: "RAN" },
    "eval as a promise reaction": { body: `await Promise.resolve(text).then(eval)`, prints: "RAN" },
    "eval through a proxy": { body: `new Proxy(eval, {})(text)`, prints: "RAN" },
    "eval from a descriptor": {
      body: `Object.getOwnPropertyDescriptor(globalThis, glue('ev', 'al')).value(text)`,
      prints: "RAN",
    },
    "function constructor": { body: `new Function(text)()`, prints: "RAN" },
    "function constructor of a function": { body: `(function () {}).constructor(text)()`, prints: "RAN" },
    "function constructor through a built in method": { body: `[].map.constructor(text)()`, prints: "RAN" },
    "function constructor under a computed name": { body: `globalThis[glue('Func', 'tion')](text)()`, prints: "RAN" },
    "function constructor under a computed member": {
      body: `(function () {})[glue('const', 'ructor')](text)()`,
      prints: "refused EvalError",
    },
    "function constructor through reflect construct": { body: `Reflect.construct(Function, [text])()`, prints: "RAN" },
    "function constructor bound": { body: `Function.bind(null, text)()()`, prints: "RAN" },
    "function constructor subclass": { body: `new (class extends Function {})(text)()`, prints: "RAN" },
    "function constructor of unknown value": {
      body: `JSON.parse('[]').constructor.constructor(text)()`,
      prints: "RAN",
    },
    "async function constructor": {
      body: `await Object.getPrototypeOf(async function () {}).constructor(text)()`,
      prints: "RAN",
    },
    "generator function constructor": {
      body: `Object.getPrototypeOf(function* () {}).constructor(text)().next()`,
      prints: "RAN",
    },
    "timeout with a string": {
      body: `setTimeout(text, 0)`,
      wait: 30,
      prints: "refused TypeError ERR_INVALID_ARG_TYPE",
    },
    "immediate with a string": {
      body: `setImmediate(text)`,
      wait: 30,
      prints: "refused TypeError ERR_INVALID_ARG_TYPE",
    },
  },
  "node:module": {
    "module compile": {
      body: `const Module = require('node:module'); const m = new Module('/x.js'); m._compile(moduleText, '/x.js')`,
      prints: "RAN",
    },
    "module compile of own module": { body: `module._compile(moduleText, '/x.js')`, extension: "cjs", prints: "RAN" },
    "module compile through constructor": {
      body: `new module.constructor('/x.js')._compile(moduleText, '/x.js')`,
      extension: "cjs",
      prints: "refused TypeError",
    },
    "module load": { body: `require('node:module')._load(temporaryFile('.js', moduleText))`, prints: "did not run" },
    "module extensions": {
      body: `const Module = require('node:module'); const f = temporaryFile('.js', moduleText); Module._extensions['.js'](new Module(f), f)`,
      prints: "refused Error ERR_MODULE_NOT_FOUND",
    },
    "module prototype load": {
      body: `const Module = require('node:module'); const f = temporaryFile('.js', moduleText); new Module(f).load(f)`,
      prints: "refused TypeError",
    },
    "module create require": {
      body: `require('node:module').createRequire('/')(temporaryFile('.js', moduleText))`,
      prints: "refused Error MODULE_NOT_FOUND",
    },
    "module run main": {
      body: `const f = temporaryFile('.js', moduleText); process.argv[1] = f; require('node:module').runMain(f)`,
      prints: "did not run",
    },
    "module register": {
      body: `require('node:module').register(require('node:url').pathToFileURL(temporaryFile('.mjs', moduleText)).href)`,
      wait: 30,
      prints: "did not run",
    },
    "module require method": {
      body: `module.require(temporaryFile('.js', moduleText))`,
      extension: "cjs",
      prints: "refused Error MODULE_NOT_FOUND",
    },
    "own extension handler compiles": {
      body: `require.extensions[glue('.unse', 'en')] = (m, f) => m._compile(require('node:fs').readFileSync(f, 'utf8'), f); require(temporaryFile('.unseen', moduleText))`,
      extension: "cjs",
      prints: "refused Error MODULE_NOT_FOUND",
    },
    "module load of vm": {
      body: `require('node:module')._load(glue('v', 'm')).runInThisContext(text)`,
      prints: "refused TypeError",
    },
    "create require of vm": {
      body: `require('node:module').createRequire('/')(glue('v', 'm')).runInThisContext(text)`,
      prints: "refused Error MODULE_NOT_FOUND",
    },
  },
  "loaders with names nobody knows": {
    "require of a file": {
      body: `require(temporaryFile('.js', moduleText))`,
      prints: "refused Error MODULE_NOT_FOUND",
    },
    "require after resolve sync": {
      body: `const f = temporaryFile('.js', moduleText); require(Bun.resolveSync(f, '/'))`,
      prints: "refused Error MODULE_NOT_FOUND",
    },
    "import meta require": {
      body: `import.meta.require(temporaryFile('.js', moduleText))`,
      extension: "mjs",
      prints: "refused Error MODULE_NOT_FOUND",
    },
    "import of a file": {
      body: `await import(temporaryFile('.mjs', moduleText))`,
      prints: "refused Error ERR_MODULE_NOT_FOUND",
    },
    "import of a data url": {
      body: `await import(glue('data:text/javascript,', encodeURIComponent(moduleText)))`,
      prints: "refused Error ERR_MODULE_NOT_FOUND",
    },
    "import of a blob url": {
      body: `await import(URL.createObjectURL(new Blob([moduleText], { type: 'text/javascript' })))`,
      prints: "refused Error ERR_MODULE_NOT_FOUND",
    },
    "import of an http url": {
      body: `const s = Bun.serve({ port: 0, fetch: () => new Response(moduleText, { headers: { 'content-type': 'text/javascript' } }) }); try { await import(glue('http://127.0.0.1:', s.port, '/x.js')); } finally { s.stop(true); }`,
      prints: "refused BuildMessage",
    },
    "require of vm under a computed name": {
      body: `require(glue('v', 'm')).runInThisContext(text)`,
      prints: "refused Error MODULE_NOT_FOUND",
    },
    "require of node vm under a computed name": {
      body: `require(glue('node:', 'vm')).runInThisContext(text)`,
      prints: "RAN",
    },
    "import of vm under a computed name": {
      body: `(await import(glue('node:', 'vm'))).runInThisContext(text)`,
      prints: "RAN",
    },
    "vm named": { body: `require('node:vm').runInThisContext(text)`, prints: "RAN" },
    "vm compile function": { body: `require('node:vm').compileFunction(text)()`, prints: "RAN" },
  },
  "process": {
    "process get builtin module vm": {
      body: `process.getBuiltinModule(glue('v', 'm')).runInThisContext(text)`,
      prints: "refused Error MODULE_NOT_FOUND",
    },
    "process get builtin module module": {
      body: `process.getBuiltinModule(glue('mod', 'ule'))._load(temporaryFile('.js', moduleText))`,
      prints: "did not run",
    },
    "process binding contextify": { body: `process.binding(glue('context', 'ify'))`, prints: "refused Error" },
    "process binding natives": {
      body: `Object.keys(process.binding(glue('nat', 'ives'))).length`,
      prints: "did not run",
    },
    "process linked binding": { body: `process._linkedBinding(glue('context', 'ify'))`, prints: "did not run" },
    "process dlopen": {
      body: `process.dlopen({ exports: {} }, temporaryFile('.node', 'not a library'))`,
      isMachineCode: true,
      prints: "refused Error ERR_DLOPEN_FAILED",
    },
    "require of an addon": {
      body: `require(temporaryFile('.node', 'not a library'))`,
      prints: "refused Error MODULE_NOT_FOUND",
    },
  },
  "workers": {
    "worker of a file": {
      body: `const w = new Worker(temporaryFile('.js', glue('postMessage(', '1)'))); await new Promise((res, rej) => { w.onmessage = () => { globalThis.RAN = 1; res(); }; w.onerror = e => rej(new Error(e.message)); w.addEventListener('close', () => rej(new Error('no message'))); }).finally(() => w.terminate())`,
      prints: "refused Error",
    },
    "worker of a blob url": {
      runsApartFromTheProgram: true,
      body: `const w = new Worker(URL.createObjectURL(new Blob([glue('postMessage(', '1)')], { type: 'text/javascript' }))); await new Promise((res, rej) => { w.onmessage = () => { globalThis.RAN = 1; res(); }; w.onerror = e => rej(new Error(e.message)); w.addEventListener('close', () => rej(new Error('no message'))); }).finally(() => w.terminate())`,
      prints: "RAN",
    },
    "worker of a data url": {
      runsApartFromTheProgram: true,
      body: `const w = new Worker(glue('data:text/javascript,', 'postMessage(1)')); await new Promise((res, rej) => { w.onmessage = () => { globalThis.RAN = 1; res(); }; w.onerror = e => rej(new Error(e.message)); w.addEventListener('close', () => rej(new Error('no message'))); }).finally(() => w.terminate())`,
      prints: "RAN",
    },
    "worker threads eval": {
      runsApartFromTheProgram: true,
      body: `const { Worker } = require('node:worker_threads'); const w = new Worker(glue('require("node:worker_threads").parentPort.postMessage(', '1)'), { eval: true }); await new Promise((res, rej) => { w.on('message', () => { globalThis.RAN = 1; res(); }); w.on('error', rej); w.on('exit', () => rej(new Error('no message'))); }).finally(() => w.terminate())`,
      prints: "RAN",
    },
    "worker with preload": {
      body: `const w = new Worker(temporaryFile('.js', ''), { preload: [temporaryFile('.js', glue('postMessage(', '1)'))] }); await new Promise((res, rej) => { w.onmessage = () => { globalThis.RAN = 1; res(); }; w.onerror = e => rej(new Error(e.message)); w.addEventListener('close', () => rej(new Error('no message'))); }).finally(() => w.terminate())`,
      prints: "refused Error",
    },
  },
  "Bun's own APIs": {
    "plugin on load returns text": {
      body: `Bun.plugin({ name: 'p', setup(b) { b.onResolve({ filter: /^virtual:/ }, a => ({ path: a.path, namespace: 'v' })); b.onLoad({ filter: /.*/, namespace: 'v' }, () => ({ contents: moduleText, loader: 'js' })); } }); await import(glue('virtual:', 'x'))`,
      prints: "RAN",
    },
    "plugin module returns text": {
      body: `Bun.plugin({ name: 'p', setup(b) { b.module(glue('virtual-', 'module'), () => ({ contents: moduleText, loader: 'js' })); } }); await import(glue('virtual-', 'module'))`,
      prints: "RAN",
    },
    "plugin on resolve returns a file": {
      body: `const f = temporaryFile('.mjs', moduleText); Bun.plugin({ name: 'p', setup(b) { b.onResolve({ filter: /^outside$/ }, () => ({ path: f })); } }); await import(glue('out', 'side'))`,
      prints: "refused Error ERR_MODULE_NOT_FOUND",
    },
    "build then import": {
      body: `const f = temporaryFile('.js', moduleText); const o = await Bun.build({ entrypoints: [f], outdir: require('node:path').dirname(f) + '/out' }); await import(o.outputs[0].path)`,
      prints: "refused Error ERR_MODULE_NOT_FOUND",
    },
    "transpiler then function": {
      body: `Function(new Bun.Transpiler({ loader: 'ts' }).transformSync(text))()`,
      prints: "RAN",
    },
    "bun ffi property": {
      body: `typeof Bun.FFI.dlopen === 'function' && Bun.FFI.dlopen(temporaryFile('.so', 'x'), {})`,
      isMachineCode: true,
      prints: "did not run",
    },
    "bun ffi named": {
      body: `require('bun:ffi').dlopen(temporaryFile('.so', 'x'), { f: { args: [], returns: 'int' } })`,
      isMachineCode: true,
      prints: "refused Error ERR_DLOPEN_FAILED",
    },
    "bun ffi cc": {
      body: `const library = require('bun:ffi').cc({ source: temporaryFile('.c', 'int f(void) { return 1; }'), symbols: { f: { returns: 'int', args: [] } } }); try { library.symbols.f() === 1 && (globalThis.RAN = 1); } finally { library.close(); }`,
      isMachineCode: true,
    },
    "bun jsc under a computed name": {
      body: `Object.keys(require(glue('bun:', 'jsc'))).length`,
      prints: "did not run",
    },
    "sqlite load extension": {
      body: `new (require('bun:sqlite').Database)(':memory:').loadExtension(temporaryFile('.so', 'x'))`,
      prints: "refused Error",
    },
    "inspector named": { body: `require('node:inspector').open(0)`, prints: "did not run" },
    "inspector under a computed name": { body: `require(glue('node:', 'inspector')).open(0)`, prints: "did not run" },
    "node test under a computed name": {
      body: `typeof require(glue('node:', 'test'))`,
      prints: "refused Error MODULE_NOT_FOUND",
    },
    "html rewriter then eval": {
      body: `let got = ''; new HTMLRewriter().on('script', { text(t) { got += t.text; } }).transform(glue('<script>', text, '</script>')); (0, eval)(got)`,
      prints: "RAN",
    },
  },
  "what is given to the executable from outside": {
    "preload in bun options": {
      body: `0`,
      env: { "BUN_OPTIONS": "--preload {FILE}" },
      prints: "",
      stderr:
        "error: --preload can't be used with this executable because it only runs code that was compiled into it. Rebuild it with --compile-inspector to load other code\n",
      exitCode: 1,
    },
    "require in node options": { body: `0`, env: { "NODE_OPTIONS": "--require {FILE}" }, prints: "did not run" },
    "preload argument": { body: `0`, args: ["--preload", "{FILE}"], prints: "did not run" },
    "require argument": { body: `0`, args: ["-r", "{FILE}"], prints: "did not run" },
    "eval argument": {
      body: `0`,
      args: ["-e", "globalThis.RAN = 1; console.log('eval-argument: RAN')"],
      prints: "did not run",
    },
    "preload in bunfig": {
      body: `0`,
      filesInWorkingDirectory: { "bunfig.toml": 'preload = ["{FILE}"]\n' },
      prints: "did not run",
    },
    "inspect in environment": {
      body: `0`,
      env: { "BUN_INSPECT": "ws://127.0.0.1:0/x" },
      prints: "",
      stderr: "error: BUN_INSPECT can't be used with this executable. Rebuild it with --compile-inspector\n",
      exitCode: 1,
    },
    "inspect argument": { body: `0`, args: ["--inspect=127.0.0.1:0"], prints: "did not run" },
    "be bun in environment": {
      body: `0`,
      env: { "BUN_BE_BUN": "1" },
      args: ["{FILE}"],
      ...(leavesOutTheCommandLine
        ? {
            prints: "",
            stderr:
              "error: BUN_BE_BUN is set, but this executable doesn't include the Bun command line. Run bun instead.\n",
            exitCode: 70,
          }
        : { replacesTheProgram: true, prints: "RAN" }),
    },
  },
  "evaluators of node:vm reached without naming the module, with objects of the program handed in": {
    "unnamed vm run in new context": {
      body: vm + `vm.runInNewContext(glue('o.n', ' = 2'), { o })` + changed,
      prints: "RAN",
    },
    "unnamed vm script in this context": {
      body: vm + `globalThis.o = o; new vm.Script(glue('o.n', ' = 2')).runInThisContext()` + changed,
      prints: "RAN",
    },
    "unnamed vm source text module": {
      body:
        vm +
        `const m = new vm.SourceTextModule(glue('globalThis.RAN', ' = 1')); await m.link(() => {}); await m.evaluate()`,
      prints: "RAN",
    },
    "unnamed vm function of new context": {
      body: vm + `vm.runInNewContext(glue('Func', 'tion'))(glue('o', ''), glue('o.n', ' = 2'))(o)` + changed,
      prints: "RAN",
    },
    "builtin module vm run in new context": {
      body:
        `const vm = process.getBuiltinModule(glue('v', 'm')); const o = { n: 1 }; vm.runInNewContext(glue('o.n', ' = 2'), { o })` +
        changed,
      prints: "refused Error MODULE_NOT_FOUND",
    },
  },
  "the module loader object": {
    "loader object exists": {
      body: `typeof Loader === 'object' && Object.getOwnPropertyNames(Object.getPrototypeOf(Loader)).length`,
      prints: "did not run",
    },
    "loader parse module": {
      body: `const k = glue('unseen:', 'x'); const m = await Loader.parseModule(k, moduleText); globalThis.PARSED = m`,
      prints: "refused ReferenceError",
    },
    "loader provide fetch": {
      body: `const k = glue('unseen:', 'x'); Loader.provideFetch(k, moduleText); await Loader.loadAndEvaluateModule(k)`,
      prints: "refused ReferenceError",
    },
    "loader load and evaluate file": {
      body: `await Loader.loadAndEvaluateModule(temporaryFile('.mjs', moduleText))`,
      prints: "refused ReferenceError",
    },
    "loader request import": {
      body: `await Loader.requestImportModule(temporaryFile('.mjs', moduleText))`,
      prints: "refused ReferenceError",
    },
    "loader registry hands out modules": {
      body: `let n = 0; for (const [k] of Loader.registry) n++; if (n) console.log('registry entries', n)`,
      prints: "refused ReferenceError",
    },
  },
  "flagged modules and members reached under names nobody knows": {
    "unnamed ffi dlopen": {
      body: `const ffi = require(glue('bun:', 'ffi')); const lib = ffi.dlopen(glue('libc.so', '.6'), { getpid: { args: [], returns: 'int' } }); if (lib.symbols.getpid() > 0) globalThis.RAN = 1`,
      prints: isGlibc ? "RAN" : undefined,
    },
    "unnamed ffi raw memory": {
      body: `const ffi = require(glue('bun:', 'ffi')); const a = new Uint8Array(8); const p = ffi.ptr(a); new Uint8Array(ffi.toArrayBuffer(p, 0, 8))[0] = 7; if (a[0] === 7) globalThis.RAN = 1`,
      prints: "RAN",
    },
    "builtin module ffi": {
      body: `const ffi = process.getBuiltinModule(glue('bun:', 'ffi')); const lib = ffi.dlopen(glue('libc.so', '.6'), { getpid: { args: [], returns: 'int' } }); if (lib.symbols.getpid() > 0) globalThis.RAN = 1`,
      prints: isGlibc ? "RAN" : undefined,
    },
    "unnamed worker threads eval": {
      runsApartFromTheProgram: true,
      body: `const { Worker } = require(glue('node:', 'worker_threads')); const w = new Worker(glue('require("node:worker_threads").parentPort.postMessage(', '1)'), { eval: true }); await new Promise((res, rej) => { w.on('message', () => { globalThis.RAN = 1; res(); }); w.on('error', rej); w.on('exit', () => rej(new Error('no message'))); }).finally(() => w.terminate())`,
      prints: "RAN",
    },
    "unnamed repl": { body: `typeof require(glue('node:', 'repl')).start`, prints: "did not run" },
    "plugin under a computed name": {
      body: `Bun[glue('plu', 'gin')]({ name: 'p', setup(b) { b.module(glue('virtual-', 'module'), () => ({ contents: moduleText, loader: 'js' })); } }); await import(glue('virtual-', 'module'))`,
      prints: "refused Error ERR_CODE_NOT_COMPILED",
    },
    "worker under a computed name": {
      body: `const w = new globalThis[glue('Wor', 'ker')](temporaryFile('.js', glue('postMessage(', '1)'))); await new Promise((res, rej) => { w.onmessage = () => { globalThis.RAN = 1; res(); }; w.onerror = e => rej(new Error(e.message)); w.addEventListener('close', () => rej(new Error('no message'))); }).finally(() => w.terminate())`,
      prints: "refused Error",
    },
    "module compile under a computed name": {
      body: `const Module = require(glue('node:', 'module')); new Module('/x.js')[glue('_com', 'pile')](moduleText, '/x.js')`,
      prints: "RAN",
    },
    "spawn of itself as bun": {
      body: `const p = Bun.spawnSync([process.execPath, '-e', glue('console.log(', '"CHILD")')], { env: { ...process.env, BUN_BE_BUN: '1' } }); if (p.stdout.toString().includes('CHILD')) console.log('a child process ran as plain Bun')`,
      prints: leavesOutTheCommandLine ? "did not run" : "a child process ran as plain Bun\ndid not run",
    },
  },
  "objects that never escaped handed out by native code": {
    "call site get function": {
      body: `function hidden() { return new Error('x').stack; } const old = Error.prepareStackTrace; let got; Error.prepareStackTrace = (e, frames) => { got = frames.map(f => typeof f.getFunction()); return ''; }; hidden(); Error.prepareStackTrace = old; console.log('getFunction gives', got.slice(0, 2).join())`,
      extension: "cjs",
      prints: "getFunction gives undefined,undefined\ndid not run",
    },
    "call site get this": {
      body: `const secret = { n: 1, m() { return new Error('x').stack; } }; const old = Error.prepareStackTrace; let got; Error.prepareStackTrace = (e, frames) => { got = frames.map(f => f.getThis()); return ''; }; secret.m(); Error.prepareStackTrace = old; if (got[0] === secret) { got[0].n = 's'; console.log('getThis gives the receiver', typeof secret.n); } else console.log('getThis gives', typeof got[0])`,
      extension: "cjs",
      prints: "getThis gives undefined\ndid not run",
    },
    "function caller": {
      body: `function inner() { return inner.caller; } function outer() { return inner(); } console.log('caller gives', typeof outer(), outer() === outer)`,
      extension: "cjs",
      prints: "caller gives object false\ndid not run",
    },
    "arguments callee caller": {
      body: `function inner() { return arguments.callee.caller; } function outer() { return inner(); } console.log('callee.caller gives', typeof outer())`,
      extension: "cjs",
      prints: "callee.caller gives object\ndid not run",
    },
    "function arguments": {
      body: `function inner() { return outer.arguments; } function outer(o) { return inner(); } const o = { n: 1 }; const a = outer(o); console.log('f.arguments gives', a && a[0] === o)`,
      extension: "cjs",
      prints: "f.arguments gives null\ndid not run",
    },
  },
  "what Bun's own library does on the application's behalf": {
    "addon extension handler": {
      body: `require('node:module')._extensions['.node']({ exports: {} }, temporaryFile('.node', 'not a library'))`,
      prints: "refused Error ERR_DLOPEN_FAILED",
    },
    "addon extension handler under a computed name": {
      body: `require('node:module')._extensions[glue('.no', 'de')]({ exports: {} }, temporaryFile('.node', 'not a library'))`,
      prints: "refused Error ERR_DLOPEN_FAILED",
    },
    "serve static plugins in bunfig": {
      body: `const page = require('./page.html'); const s = Bun.serve({ port: 0, routes: { '/': page.default ?? page } }); try { await (await fetch(s.url)).text(); } finally { s.stop(true); }`,
      wait: 50,
      filesInWorkingDirectory: { "bunfig.toml": '[serve.static]\nplugins = ["{FILE}"]\n' },
      prints: "did not run",
    },
    "serve development with plugins in bunfig": {
      body: `const page = require('./page.html'); const s = Bun.serve({ port: 0, development: true, routes: { '/': page.default ?? page } }); try { await (await fetch(s.url)).text(); } finally { s.stop(true); }`,
      wait: 50,
      filesInWorkingDirectory: { "bunfig.toml": '[serve.static]\nplugins = ["{FILE}"]\n' },
      prints: "did not run",
    },
    "build with a macro": {
      body: `const f = temporaryFile('.ts', glue('import { m } from "./macro.ts" with { type: "macro" }; console.log(m());')); require('node:fs').writeFileSync(require('node:path').dirname(f) + '/macro.ts', glue('import { writeFileSync } from "node:fs"; export function m() { writeFileSync(', JSON.stringify(require('node:path').dirname(f) + '/ran'), ', "1"); return 1; }')); await Bun.build({ entrypoints: [f] }); if (require('node:fs').existsSync(require('node:path').dirname(f) + '/ran')) globalThis.RAN = 1`,
      prints: "refused AggregateError",
      stderr:
        /^error: Cannot load '.*macro\.ts': it isn't in this executable, which only runs code that was compiled into it\./m,
    },
    "transpiler with a macro": {
      body: `const f = temporaryFile('.ts', glue('export function m() { globalThis.RAN', ' = 1; return 1; }')); new Bun.Transpiler({ loader: 'ts', macro: {} }).transformSync(glue('import { m } from ', JSON.stringify(f), ' with { type: "macro" }; m();'))`,
      prints: "refused BuildMessage",
    },
    "transpiler with a macro out of a built-in module": {
      body: `new Bun.Transpiler({ loader: 'ts' }).transformSync(glue('import { runInThisContext as m } from "node:vm" with { type: "macro" }; m(', JSON.stringify(text), ');'))`,
      prints: "refused BuildMessage",
    },
    "transpiler that scans a text with a macro": {
      body: `new Bun.Transpiler({ loader: 'ts' }).scan(glue('import { runInThisContext as m } from "node:vm" with { type: "macro" }; m(', JSON.stringify(text), ');'))`,
      prints: "refused BuildMessage",
    },
    "build plugin from a file": {
      body: `const f = temporaryFile('.js', moduleText); await Bun.build({ entrypoints: [f], plugins: [require(f)] })`,
      prints: "refused Error MODULE_NOT_FOUND",
    },
  },
};

// A route for which the build finds an event is a program of its own, unless `reportedAlike` below lists it: the report has a line for each kind of event and each API, with one place, so in company it would not tell whose an event is.
// The routes for which the build finds none are files of one program, whose entry point loads the file that ROUTE names: that program stays closed, and a route in it that runs the code fails.
const findsNoEvent = new Set([
  "arguments callee caller",
  "be bun in environment",
  "call site get function",
  "call site get this",
  "eval argument",
  "function arguments",
  "function caller",
  "function constructor under a computed member",
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
  "module prototype load",
  "module register",
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
  "worker with preload",
]);

// Many routes for which the build finds an event run nothing all the same. Those of them that the build reports alike can be files of one program: of each alone
// it prints the same `blocked by` lines, but for the places in them, and of their program it prints those lines again. No event of such a program is known to be
// the event of one route: where a program is open, the report also has lines at statements that open nothing alone. So a route in company is held to the rule of
// the closed program, and fails if it runs the code. It prints there what it prints alone. A route that runs the code is always a program of its own, where an
// event is its own.
// Only a Bun with a sanitizer builds them in company. There a build takes several times as long, and what a sanitizer finds it finds by the code that runs over a
// route, not by a verdict. Every other Bun builds each of these routes alone as well, and so shows that the build finds an event for each.
// AOT_EVERY_ROUTE_ALONE=1 | 0 asks for either anywhere. These lists are made by hand.
const asked = process.env.AOT_EVERY_ROUTE_ALONE || undefined;
if (asked !== undefined && asked !== "1" && asked !== "0")
  throw new Error(`AOT_EVERY_ROUTE_ALONE is 1 or 0, not ${JSON.stringify(asked)}`);
const everyRouteAlone = asked === undefined ? !isASAN : asked === "1";
const reportedAlike = [
  [
    "module require method",
    "require of a file",
    "require after resolve sync",
    "import of a file",
    "import of a data url",
    "import of a blob url",
    "import of an http url",
    "require of vm under a computed name",
    "require of an addon",
    "bun jsc under a computed name",
    "node test under a computed name",
  ],
  ["module extensions", "addon extension handler", "addon extension handler under a computed name"],
  ["process get builtin module vm", "process get builtin module module", "builtin module vm run in new context"],
  ["build then import", "build plugin from a file"],
  ["module load", "module load of vm"],
  ["module create require", "create require of vm"],
];

/** `file`: as the build prints it. Undefined: the event lies nowhere in the program. */
type Event = { file: string | undefined };
// That the program starts a Worker from code outside the executable is printed in a line of the same make. It is no event: that code runs apart from the program.
const lineOfEvent =
  /^aot: trim: blocked by (?!dynamic-import: the program starts a Worker from code that isn't in the executable)[\w-]+: .*?(?: at (.+):\d+:\d+)?$/;
const all = Object.entries(routes).flatMap(([group, members]) =>
  Object.entries(members).map(([name, route]) => ({
    group,
    name,
    route,
    file: `${name.replaceAll(" ", "-")}.${route.extension ?? "js"}`,
  })),
);
const listed = [...findsNoEvent, ...reportedAlike.flat()];
for (const name of listed)
  if (!all.some(route => route.name === name) || listed.indexOf(name) !== listed.lastIndexOf(name))
    throw new Error(`"${name}" is no route, or is listed twice`);
/** The groups that are a program each with this Bun. */
const builtInCompany: string[][] = everyRouteAlone ? [] : reportedAlike;
/** The routes that are files of a program of several. */
const inCompany = [...findsNoEvent, ...builtInCompany.flat()];
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
  const said = await spawned(
    [bunExe(), "build", "--compile", "--aot", "--explain=trim", main, "--outfile", executable],
    folder,
    { ...bunEnv, NO_COLOR: "1" },
  );
  built(said);
  const events: Event[] = said.stderr.split(/\r?\n/).flatMap(line => {
    const found = lineOfEvent.exec(line);
    return found ? [{ file: found[1] }] : [];
  });
  return { executable, events };
}

/**
 * A program of several routes. Its entry point loads the file that ROUTE names. It requires a CommonJS file, so that the file runs as it does where it is the
 * entry point itself: import() takes a .cjs file that names neither `require` nor `module` for an ES module and runs it as strict code, where reading `caller`,
 * `callee` or `arguments` of a function throws. The first test that asks for the program makes its folder and builds it.
 */
function programOf(members: typeof all) {
  const files = () => ({
    "main.js":
      `const routes = {\n${members.map(({ file }) => `  ${JSON.stringify(file)}: () => ${file.endsWith(".cjs") ? "require" : "import"}("./${file}"),\n`).join("")}};\n` +
      `routes[process.env.ROUTE]();\n`,
    ...Object.fromEntries(members.map(({ file, route }) => [file, textOf(route)])),
    ...others,
  });
  let dir: ReturnType<typeof tempDir> | undefined;
  afterAll(() => dir?.[Symbol.dispose]());
  let made: ReturnType<typeof build> | undefined;
  return () => (made ??= slot(() => build(String((dir = tempDir("aot-unseen-code", files()))), "main.js")));
}

// What a program prints where nothing says so: one of the three answers of attempt().
const anAnswer = /^(?:RAN|did not run|refused \w+(?: \w+)?)\n$/;

/** `hasAnEventOfItsOwn`: the build found an event for a program of this route alone. */
async function judge(
  folder: string,
  executable: string,
  hasAnEventOfItsOwn: boolean,
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
  const ranTheCode = /^RAN$/m.test(ran.stdout);
  expect({
    // The build says that machine code may be loaded, and the load is not refused. Whether the library or the C compiler is there depends on the machine.
    ...(route.isMachineCode && {
      sawAnEvent: hasAnEventOfItsOwn,
      isRefusedAsUnseenCode: /^refused Error ERR_CODE_NOT_COMPILED$/m.test(ran.stdout),
    }),
    // The rule of the file, whatever `prints` says: the code runs only apart from the program, where the build found an event of the route, or in the place of the program.
    ranTheCode: route.runsApartFromTheProgram
      ? ranTheCode
      : ranTheCode && !hasAnEventOfItsOwn && !route.replacesTheProgram,
    stdout: ran.stdout,
    // C's descriptor 2 translates line ends on Windows.
    stderr: ran.stderr.replaceAll("\r\n", "\n"),
    exitCode: ran.exitCode,
    signal: ran.signal,
  }).toEqual({
    ...(route.isMachineCode && { sawAnEvent: true, isRefusedAsUnseenCode: false }),
    ranTheCode: !!route.runsApartFromTheProgram,
    stdout:
      route.prints === undefined ? expect.stringMatching(anAnswer) : route.prints === "" ? "" : route.prints + "\n",
    stderr: route.stderr instanceof RegExp ? expect.stringMatching(route.stderr) : (route.stderr ?? ""),
    exitCode: route.exitCode ?? 0,
    signal: null,
  });
}

export function codeTheCompilerNeverSaw() {
  describe.concurrent("code the compiler never saw, in a program of its own", () => {
    for (const { group, name, route, file } of all.filter(({ name }) => !inCompany.includes(name))) {
      test(
        `${group}: ${name}`,
        () =>
          slot(async () => {
            using dir = tempDir("aot-unseen-code", { [file]: textOf(route), ...others });
            const { executable, events } = await build(String(dir), file);
            expect({ sawAnEvent: events.length > 0 }).toEqual({ sawAnEvent: true });
            await judge(String(dir), executable, true, route);
          }),
        600_000,
      );
    }
  });

  describe("code the compiler never saw, in a program of routes that the build reports alike", () => {
    // bun test keeps as many tests under way as --max-concurrency says, in the order of their declaration, and the first test of a program builds it. So the
    // first route of every program comes first, then the second of each: the builds run beside one another.
    const inTurns = builtInCompany
      .flatMap(names => {
        const members = names.map(name => all.find(route => route.name === name)!);
        const program = programOf(members);
        return members.map((member, turn) => ({ member, program, turn }));
      })
      .sort((one, other) => one.turn - other.turn);
    for (const { member, program } of inTurns) {
      test.concurrent(
        `${member.group}: ${member.name}`,
        async () => {
          const { executable, events } = await program();
          expect({ sawAnEvent: events.length > 0 }).toEqual({ sawAnEvent: true });
          await slot(async () => {
            using run = tempDir("aot-unseen-code-run", others);
            await judge(String(run), executable, false, member.route, { ROUTE: member.file });
          });
        },
        600_000,
      );
    }
  });

  describe("code the compiler never saw, in a program that the build finds closed", () => {
    const members = all.filter(({ name }) => findsNoEvent.has(name));
    const program = programOf(members);
    for (const { group, name, route, file } of members) {
      test.concurrent(
        `${group}: ${name}`,
        async () => {
          const { executable, events } = await program();
          expect(events).toEqual([]);
          await slot(async () => {
            using run = tempDir("aot-unseen-code-run", others);
            await judge(String(run), executable, false, route, { ROUTE: file });
          });
        },
        600_000,
      );
    }
  });
}
