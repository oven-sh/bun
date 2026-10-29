// A promise is rejected by something other than the text of the program: the module loader, a built-in that refuses its operands, the file system, the network,
// a stream, a timer, text made at run time. A handler takes what it was rejected with and looks at it. A program holds one promise, one way to attach the handler
// and one look, or every look at once.
//
//   the promise   import() of a file of the program, a built-in module or a computed name with options, attributes or a name that the loader refuses; a file that throws;
//                 the combinators and Promise.try; a built-in as the handler of then(); async functions and generators; fetch and bodies; node:fs, Bun.file;
//                 WebAssembly; crypto.subtle; streams; timers, events and signals; disposal; evaluated text and another realm
//   the handler   then(_, f), catch(f), try { await }, behind finally(), thrown again, a declared function, attached late, behind a combinator, with a declared type
//   the look      message, name, stack, instanceof, String(), code, typeof, the constructor, the keys, a pattern, a comparison with undefined
//
// Two more groups make promises where there is hardly any room left: at every depth close to the end of the stack, and in a heap that is filled until nothing fits.
// Where the room ends differs from build to build, so such a program prints only what a handler was handed that is no RangeError.

export type Rejection = {
  /** An expression for the promise. */
  promise: string;
  /** Statements ahead of it. */
  needs?: string;
  /** The loader rejects it though the file that it names neither imports nor throws anything. */
  isOfTheLoaderAlone?: true;
  /** The message names the folder of the program, which an executable does not have, or quotes the source, which docs/compiler/compatibility.mdx says an executable does otherwise. */
  messageDiffers?: true;
  /** It begins its work in a then() of its own. */
  beginsInItsOwnThen?: true;
};

export const files: Record<string, string> = {
  "leaf.mjs": "export const v = 1;\n",
  "leaf.cjs": "module.exports = { v: 1 };\n",
  "leaf.json": '{ "v": 1 }\n',
  "leaf.txt": "text\n",
  "throws.mjs": 'throw new RangeError("thrown by the file");\n',
  "throws-a-number.mjs": "throw 5;\n",
  "reads-early.mjs": "export const first = second;\nconst second = 1;\n",
  "awaits.mjs": 'await Promise.reject(new EvalError("awaited by the file"));\nexport const v = 1;\n',
  "calls-nothing.mjs": "export const v = globalThis.nothingOfThisName();\n",
  "imports-what-throws.mjs": 'import "./throws.mjs";\nexport const v = 1;\n',
};

const refusedOptions = [
  "5",
  '"options"',
  "null",
  "true",
  "Symbol.iterator",
  "{ with: 5 }",
  '{ with: "attributes" }',
  "{ with: { type: 5 } }",
  "{ with: { type: null } }",
  '{\nget with() {\nthrow new URIError("thrown by a getter");\n},\n}',
  '{ with: {\nget type() {\nthrow new URIError("thrown by a getter of the attributes");\n},\n} }',
  'new Proxy({}, {\nget() {\nthrow new URIError("thrown by a trap");\n},\n})',
];
const loaded = ['"./leaf.mjs"', '"./leaf.cjs"', '"./leaf.json"', '"./leaf.txt"', '"node:path"', '"node:fs"'];

const byTheLoader: Rejection[] = [
  ...refusedOptions.map(options => ({
    promise: `import("./leaf.mjs", ${options})`,
    isOfTheLoaderAlone: true as const,
  })),
  ...loaded.slice(1).flatMap(name => [
    { promise: `import(${name}, 5)`, isOfTheLoaderAlone: true as const },
    { promise: `import(${name}, { with: 5 })`, isOfTheLoaderAlone: true as const },
  ]),
  { promise: `load()`, needs: `const load = () => import("./leaf.mjs", 5);`, isOfTheLoaderAlone: true },
  { promise: `load(5)`, needs: `const load = options => import("./leaf.mjs", options);`, isOfTheLoaderAlone: true },
  {
    promise: `loads[1]`,
    needs: `const loads = [undefined, 5].map(options => import("./leaf.mjs", options));`,
    isOfTheLoaderAlone: true,
  },
  { promise: `import("./throws.mjs")` },
  { promise: `import("./throws.mjs", 5)` },
  { promise: `import("./throws-a-number.mjs")` },
  { promise: `import("./reads-early.mjs")` },
  { promise: `import("./awaits.mjs")` },
  { promise: `import("./calls-nothing.mjs")` },
  { promise: `import("./imports-what-throws.mjs")` },
  { promise: `import("./throws.mjs").catch(() => import("./throws.mjs"))` },
  { promise: `import("./lea" + made("f") + ".mjs", 5)`, needs: `const made = text => text.split("").join("");` },
  {
    promise: `import("./nothing-" + made("here") + ".mjs")`,
    needs: `const made = text => text.split("").join("");`,
    messageDiffers: true,
  },
  { promise: `import(Symbol("name"))` },
  { promise: `import("data:text/javascript,let let = 1 +")` },
  {
    promise: `import("data:text/javascript," + made("let let = 1 +"))`,
    needs: `const made = text => text.split("").join("");`,
  },
  { promise: `import({\ntoString() {\nthrow new URIError("thrown by toString");\n},\n})` },
  { promise: `import(made("node:nothing-here"))`, needs: `const made = text => text.split("").join("");` },
];

const byBuiltIns: Rejection[] = [
  { promise: `Promise.all(5)` },
  { promise: `Promise.race(5)` },
  { promise: `Promise.allSettled(5)` },
  { promise: `Promise.any(5)` },
  { promise: `Promise.any([])` },
  { promise: `Promise.all({\n[Symbol.iterator]() {\nreturn {};\n},\n})` },
  { promise: `Promise.try(() => null.member)` },
  { promise: `Promise.try(structuredClone, () => {})` },
  { promise: `Promise.try(5)` },
  { promise: `Promise.resolve({\nget then() {\nreturn null.member;\n},\n})` },
  {
    promise: `itself`,
    needs: `let settle;\nconst itself = new Promise(resolve => (settle = resolve));\nsettle(itself);`,
  },
  { promise: `Promise.resolve(() => {}).then(structuredClone)` },
  { promise: `Promise.resolve(1.5).then(BigInt)` },
  { promise: `Promise.resolve("{").then(JSON.parse)` },
  { promise: `Promise.resolve("%").then(decodeURIComponent)` },
  { promise: `Promise.resolve(1).then(Symbol.prototype.toString)` },
  { promise: `Promise.resolve(-1).then(Array)` },
  { promise: `Promise.resolve(Symbol()).then(Math.abs)` },
  { promise: `Promise.resolve(1).finally(Symbol.prototype.valueOf)` },
  { promise: `Promise.reject("%").catch(decodeURIComponent)` },
  { promise: `new Promise(resolve => resolve(structuredClone(() => {})))` },
  { promise: `Promise.resolve().then(() => structuredClone(Symbol()))` },
  { promise: `Array.fromAsync(null)` },
  { promise: `Array.fromAsync({\nlength: 1,\nget 0() {\nreturn null.member;\n},\n})` },
  { promise: `Array.fromAsync([1], 5)` },
  { promise: `new AsyncDisposableStack().disposeAsync.call({})` },
  {
    promise: `stack.disposeAsync()`,
    needs: `const stack = new AsyncDisposableStack();\nstack.defer(() => null.member);`,
  },
  {
    promise: `stack.disposeAsync()`,
    needs: `const stack = new AsyncDisposableStack();\nstack.defer(() => null.member);\nstack.defer(() => undefined.member);`,
  },
];

const byTheLanguage: Rejection[] = [
  { promise: `(async value => value.member)(null)`, messageDiffers: true },
  { promise: `(async (value = null.member) => value)()` },
  { promise: `(async ({ member }) => member)()` },
  { promise: `(async value => value())(undefined)` },
  { promise: `(async (left, right) => left + right)(1n, 1)` },
  { promise: `(async length => new Array(length))(-1)` },
  { promise: `(async count => "text".repeat(count))(-1)` },
  { promise: `(async () => nothingOfThisName)()` },
  { promise: `(async () => new (class extends Object {\nconstructor() {}\n})())()` },
  { promise: `(async () => {\nfor (const one of 5);\n})()` },
  { promise: `(async () => {\nfor await (const one of 5);\n})()` },
  { promise: `(async () => {\nfor await (const one of [Promise.all(5)]);\n})()` },
  { promise: `(async () => {\nawait using held = {\n[Symbol.asyncDispose]() {\nreturn null.member;\n},\n};\n})()` },
  { promise: `(async () => {\nawait using held = 5;\n})()` },
  { promise: `(async function* () {})().next.call({})` },
  { promise: `(async function* () {})().return.call(5)` },
  { promise: `(async function* () {\nyield null.member;\n})().next()` },
  { promise: `(async function* () {\nyield* 5;\n})().next()` },
  { promise: `(async function* () {})().return(Promise.all(5))` },
  { promise: `(async function endless(depth) {\nreturn (await endless(depth + 1)) + 1;\n})(0)` },
];

const byTheHost: Rejection[] = [
  { promise: `fetch("no address")` },
  { promise: `fetch("http://127.0.0.1:1/")` },
  { promise: `fetch("http://127.0.0.1:1/", { signal: AbortSignal.abort() })` },
  { promise: `fetch(Symbol("address"))` },
  { promise: `new Response("{").json()` },
  { promise: `body.text()`, needs: `const body = new Response("text");\nawait body.text();` },
  { promise: `new Request("http://localhost/", { method: "POST", body: "{" }).json()` },
  { promise: `new Blob(["{"]).json()` },
  { promise: `new Response("text").formData()` },
  { promise: `Promise.try(() => Response.prototype.text.call({}))` },
  { promise: `Promise.try(() => Blob.prototype.text.call({}))` },
  { promise: `fs.promises.readFile("/nothing/here")`, needs: `import fs from "node:fs";` },
  { promise: `readFile("/nothing/here")`, needs: `import { readFile } from "node:fs/promises";` },
  { promise: `stat("/nothing/here")`, needs: `import { stat } from "node:fs/promises";` },
  { promise: `open("/nothing/here")`, needs: `import { open } from "node:fs/promises";` },
  { promise: `readdir("/nothing/here")`, needs: `import { readdir } from "node:fs/promises";` },
  { promise: `access("/nothing/here")`, needs: `import { access } from "node:fs/promises";` },
  { promise: `rm("/nothing/here")`, needs: `import { rm } from "node:fs/promises";` },
  { promise: `mkdir("/nothing/here/below")`, needs: `import { mkdir } from "node:fs/promises";` },
  { promise: `readFile(5.5)`, needs: `import { readFile } from "node:fs/promises";` },
  {
    promise: `promisify(readFile)("/nothing/here")`,
    needs: `import { readFile } from "node:fs";\nimport { promisify } from "node:util";`,
  },
  {
    promise: `promisify(gunzip)(Buffer.from("text"))`,
    needs: `import { promisify } from "node:util";\nimport { gunzip } from "node:zlib";`,
  },
  { promise: `Bun.file("/nothing/here").text()` },
  { promise: `Bun.file("/nothing/here").json()` },
  { promise: `Bun.file("/nothing/here").bytes()` },
  { promise: `Bun.file("/nothing/here").arrayBuffer()` },
  { promise: `Bun.file("/nothing/here").stat()` },
  { promise: `Bun.file("/nothing/here").delete()` },
  { promise: `Bun.write("/nothing/here/below", "text", { createPath: false })` },
  { promise: `Bun.password.verify("word", "no hash")` },
  { promise: `Bun.$\`exit 3\`.quiet()`, beginsInItsOwnThen: true },
  {
    promise: `Bun.readableStreamToText(failed)`,
    needs: `const failed = new ReadableStream({\nstart(controller) {\ncontroller.error(new EvalError("of the stream"));\n},\n});`,
  },
  {
    promise: `Bun.readableStreamToJSON(cut)`,
    needs: `const cut = new ReadableStream({\nstart(controller) {\ncontroller.enqueue("{");\ncontroller.close();\n},\n});`,
  },
  { promise: `WebAssembly.instantiate(new Uint8Array([1, 2, 3]))` },
  { promise: `WebAssembly.compile(new Uint8Array([1, 2, 3]))` },
  { promise: `WebAssembly.instantiate(5)`, messageDiffers: true },
  {
    promise: `WebAssembly.instantiate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 2, 7, 1, 1, 97, 1, 98, 0, 0]))`,
  },
  { promise: `crypto.subtle.digest("no algorithm", new Uint8Array(1))` },
  { promise: `crypto.subtle.importKey("raw", new Uint8Array(1), "no algorithm", false, [])` },
  { promise: `crypto.subtle.generateKey({ name: "AES-GCM", length: 7 }, false, ["encrypt"])` },
  {
    promise: `failed.getReader().read()`,
    needs: `const failed = new ReadableStream({\nstart(controller) {\ncontroller.error(new EvalError("of the stream"));\n},\n});`,
  },
  {
    promise: `failed.getReader().closed`,
    needs: `const failed = new ReadableStream({\nstart(controller) {\ncontroller.error(new EvalError("of the stream"));\n},\n});`,
  },
  { promise: `locked.cancel()`, needs: `const locked = new ReadableStream();\nlocked.getReader();` },
  {
    promise: `locked.pipeTo(new WritableStream())`,
    needs: `const locked = new ReadableStream();\nlocked.getReader();`,
  },
  { promise: `new ReadableStream({\npull() {\nreturn null.member;\n},\n}).getReader().read()` },
  { promise: `writer.write(1)`, needs: `const writer = new WritableStream().getWriter();\nwriter.close();` },
  { promise: `new WritableStream({\nwrite() {\nreturn null.member;\n},\n}).getWriter().write(1)` },
  { promise: `locked.close()`, needs: `const locked = new WritableStream();\nlocked.getWriter();` },
  {
    promise: `new Response(new Blob([new Uint8Array([255])]).stream().pipeThrough(new TextDecoderStream("utf-8", { fatal: true }))).text()`,
  },
  { promise: `new Response(new Blob(["text"]).stream().pipeThrough(new DecompressionStream("gzip"))).text()` },
  {
    promise: `wait(1000, 1, { signal: AbortSignal.abort() })`,
    needs: `import { setTimeout as wait } from "node:timers/promises";`,
  },
  {
    promise: `wait(1000, 1, { signal: AbortSignal.timeout(1) })`,
    needs: `import { setTimeout as wait } from "node:timers/promises";`,
  },
  { promise: `wait(1, 1, 5)`, needs: `import { setTimeout as wait } from "node:timers/promises";` },
  {
    promise: `once(new EventTarget(), "event", { signal: AbortSignal.abort() })`,
    needs: `import { once } from "node:events";`,
  },
  {
    promise: `heard`,
    needs: `import { EventEmitter, once } from "node:events";\nconst emitter = new EventEmitter();\nconst heard = once(emitter, "event");\nemitter.emit("error", new EvalError("emitted"));`,
  },
  { promise: `Promise.resolve(AbortSignal.abort()).then(signal => signal.throwIfAborted())` },
  {
    promise: `pipeline(Readable.from((function* () {\nyield null.member;\n})()), new Writable({\nwrite(chunk, encoding, done) {\ndone();\n},\n}))`,
    needs: `import { Readable, Writable } from "node:stream";\nimport { pipeline } from "node:stream/promises";`,
  },
  {
    promise: `finished(destroyed)`,
    needs: `import { Readable } from "node:stream";\nimport { finished } from "node:stream/promises";\nconst destroyed = new Readable({ read() {} });\ndestroyed.destroy(new EvalError("destroyed"));`,
  },
  {
    promise: `Readable.from((function* () {\nyield null.member;\n})()).toArray()`,
    needs: `import { Readable } from "node:stream";`,
  },
  {
    promise: `promisify(exec)("exit 3")`,
    needs: `import { exec } from "node:child_process";\nimport { promisify } from "node:util";`,
  },
  { promise: `new Promise((_, reject) => queueMicrotask(() => reject(new EvalError("in a job"))))` },
  { promise: `new Promise((_, reject) => process.nextTick(reject, new EvalError("in a tick")))` },
  { promise: `new Promise((_, reject) => setTimeout(reject, 1, new EvalError("in a timer")))` },
  {
    promise: `handed.promise`,
    needs: `const handed = Promise.withResolvers();\nsetTimeout(handed.reject, 1, new EvalError("in a timer"));`,
  },
  { promise: `Promise.resolve({\nthen(_, reject) {\nsetTimeout(reject, 1, new EvalError("in a timer"));\n},\n})` },
];

const byTextOfTheRun: Rejection[] = [
  { promise: `(0, eval)('Promise.reject(new EvalError("of the text"))')` },
  { promise: `(0, eval)("(async () => null.member)()")` },
  { promise: `new Function("return Promise.all(5)")()` },
  { promise: `new Function("value", "return (async () => value.member)()")(null)`, messageDiffers: true },
  {
    promise: `runInNewContext('Promise.reject(new EvalError("of another realm"))')`,
    needs: `import { runInNewContext } from "node:vm";`,
  },
  { promise: `runInNewContext("Promise.all(5)")`, needs: `import { runInNewContext } from "node:vm";` },
];

export const rejections: readonly Rejection[] = [
  ...byTheLoader,
  ...byBuiltIns,
  ...byTheLanguage,
  ...byTheHost,
  ...byTextOfTheRun,
];

/** Each takes the name of what the handler was handed and gives an expression to print. */
export const looks: readonly (readonly [string, (error: string) => string])[] = [
  ["message", error => `${error}.message`],
  ["name", error => `${error}.name`],
  ["stack", error => `typeof ${error}.stack`],
  [
    "instanceof",
    error => `[${error} instanceof Error, ${error} instanceof TypeError, ${error} instanceof RangeError].join()`,
  ],
  ["String", error => `String(${error})`],
  ["template", error => `\`\${${error}}\``],
  ["code", error => `${error}?.code`],
  ["typeof", error => `typeof ${error}`],
  ["tag", error => `Object.prototype.toString.call(${error})`],
  ["constructor", error => `${error}.constructor.name`],
  ["in", error => `typeof ${error} === "object" && "message" in ${error}`],
  ["keys", error => `Object.keys(${error}).join()`],
  ["undefined", error => `[${error} === undefined, ${error} == null, !${error}].join()`],
  ["pattern", error => `(({ message, name }) => name + ": " + message)(${error})`],
  ["length", error => `${error}.message?.length`],
  ["isError", error => `Error.isError(${error})`],
  ["cause", error => `[${error}.cause, ${error}.errors?.length].join()`],
  [
    "prototype",
    error =>
      `[TypeError, RangeError, SyntaxError, Error].findIndex(one => Object.getPrototypeOf(${error}) === one.prototype)`,
  ],
];

type Handler = {
  name: string;
  /** `seen` stands for the statement that prints. It names what was handed over `error`. */
  attach: (promise: string, seen: string) => string;
  isTyped?: true;
  /** It stands on the promise itself, so it is handed what that promise holds and nothing that another built-in has put in between. */
  standsOnThePromise?: true;
};

const fulfilled = `value => console.log("fulfilled", typeof value)`;

export const handlers: readonly Handler[] = [
  {
    name: "then",
    attach: (promise, seen) => `await ${promise}.then(${fulfilled}, error => {\n${seen}\n});`,
    standsOnThePromise: true,
  },
  {
    name: "catch",
    attach: (promise, seen) => `await ${promise}.catch(error => {\n${seen}\n});`,
    standsOnThePromise: true,
  },
  {
    name: "then(undefined)",
    attach: (promise, seen) => `await ${promise}.then(undefined, error => {\n${seen}\n});`,
    standsOnThePromise: true,
  },
  {
    name: "await",
    attach: (promise, seen) =>
      `try {\nconsole.log("fulfilled", typeof (await ${promise}));\n} catch (error) {\n${seen}\n}`,
  },
  { name: "finally", attach: (promise, seen) => `await ${promise}.finally(() => {}).catch(error => {\n${seen}\n});` },
  {
    name: "thrown again",
    attach: (promise, seen) => `await ${promise}.catch(first => {\nthrow first;\n}).catch(error => {\n${seen}\n});`,
  },
  {
    name: "declared function",
    attach: (promise, seen) => `function handle(error) {\n${seen}\n}\nawait ${promise}.catch(handle);`,
    standsOnThePromise: true,
  },
  {
    name: "late",
    attach: (promise, seen) =>
      `const kept = ${promise};\nkept.catch(() => {});\nawait new Promise(resolve => setTimeout(resolve, 30));\nawait kept.catch(error => {\n${seen}\n});`,
    standsOnThePromise: true,
  },
  {
    name: "read later",
    attach: (promise, seen) => `let error;\nawait ${promise}.catch(handed => {\nerror = handed;\n});\n${seen}`,
    standsOnThePromise: true,
  },
  { name: "Promise.all", attach: (promise, seen) => `await Promise.all([${promise}]).catch(error => {\n${seen}\n});` },
  {
    name: "allSettled",
    attach: (promise, seen) => `const [{ reason: error }] = await Promise.allSettled([${promise}]);\n${seen}`,
  },
  {
    name: "async function",
    attach: (promise, seen) => `await (async () => ${promise})().catch(error => {\n${seen}\n});`,
  },
  {
    name: "then.call",
    attach: (promise, seen) => `await Promise.prototype.then.call(${promise}, undefined, error => {\n${seen}\n});`,
    standsOnThePromise: true,
  },
  {
    name: "declared Error",
    attach: (promise, seen) => `await ${promise}.catch((error: Error) => {\n${seen}\n});`,
    isTyped: true,
    standsOnThePromise: true,
  },
  {
    name: "declared unknown",
    attach: (promise, seen) =>
      `await ${promise}.catch((handed: unknown) => {\nconst error = handed as Error;\n${seen}\n});`,
    isTyped: true,
    standsOnThePromise: true,
  },
];

export const everyLook = "every look";
export const looksThatShowTheMessage: readonly string[] = ["message", "String", "template", "pattern", "length"];

export function nameOf(rejection: Rejection, handler: Handler, look: string) {
  const needs = rejection.needs ? ` (${rejection.needs.replaceAll("\n", " ")})` : "";
  return `${rejection.promise.replaceAll("\n", " ")}${needs} | ${handler.name} | ${look}`;
}

export function generate(rejection: Rejection, handler: Handler, look: string) {
  const chosen = (look === everyLook ? looks : looks.filter(([name]) => name === look)).filter(
    ([name]) => !rejection.messageDiffers || !looksThatShowTheMessage.includes(name),
  );
  const seen = chosen
    .map(([name, expression]) => `console.log(${JSON.stringify(name + ":")}, ${expression("error")});`)
    .join("\n");
  const needs = rejection.needs?.split("\n") ?? [];
  const isImport = (line: string) => line.startsWith("import ");
  return [
    // Most of these promises are mistakes in the eyes of TypeScript, and a mistake stops a build.
    ...(handler.isTyped ? ["// @ts-nocheck"] : []),
    ...needs.filter(isImport),
    ...needs.filter(line => !isImport(line)),
    handler.attach(rejection.promise, seen),
    `console.log("ended");`,
    "",
  ].join("\n");
}

/** What makes a promise: the statements it needs, and the expression. `n` is a number that differs from turn to turn. */
export const makers: readonly (readonly [string, string, string])[] = [
  ["async function", "async function make() {\nreturn 1;\n}", "make()"],
  ["async arrow", "const make = async () => {};", "make()"],
  ["async arrow that returns its argument", "const make = async value => value;", "make(n)"],
  ["async method", "const holder = {\nasync make() {\nreturn 2;\n},\n};", "holder.make()"],
  [
    "async method of a class",
    "class Maker {\nasync make() {\nreturn 3;\n}\n}\nconst holder = new Maker();",
    "holder.make()",
  ],
  [
    "async function that calls",
    "function add(value) {\nreturn value + 1;\n}\nasync function make(value) {\nreturn add(value);\n}",
    "make(n)",
  ],
  [
    "async function that calls an async function",
    "async function inner() {\nreturn 1;\n}\nasync function make() {\nreturn inner();\n}",
    "make()",
  ],
  [
    "async function that makes an object",
    "async function make(value) {\nreturn { a: value, b: value, c: value, d: value };\n}",
    "make(n)",
  ],
  [
    "async function that makes a list",
    "async function make(value) {\nreturn [value, value, value, value, value, value];\n}",
    "make(n)",
  ],
  ["async function that makes a closure", "async function make(value) {\nreturn () => value;\n}", "make(n)"],
  ["async generator, next", "async function* steps() {\nyield 1;\n}", "steps().next()"],
  ["async generator, return", "async function* steps() {\nyield 1;\n}", "steps().return(1)"],
  ["import", "", 'import("./leaf.mjs")'],
  ["then that makes an object", "", "Promise.resolve(n).then(value => ({ a: value, b: value, c: value, d: value }))"],
  ["then that makes a list", "", "Promise.resolve(n).then(value => [value, value, value, value, value, value])"],
  ["then that adds", "", "Promise.resolve(n).then(value => value + 0.5)"],
  ["Promise.resolve", "", "Promise.resolve(n)"],
  ["Promise.try", "", "Promise.try(() => 1)"],
  ["Promise.all", "", "Promise.all([n])"],
  ["new Promise", "", "new Promise(resolve => resolve(n))"],
  ["Array.fromAsync", "", "Array.fromAsync([n])"],
];

const judge = `const wrong = new Set();
const judge = error => {
if (!(error instanceof RangeError) || typeof error.message !== "string" || error.name !== "RangeError") wrong.add(typeof error + " " + String(error));
};`;
const verdict = `console.log("handed something else:", [...wrong].join(", ") || "never");`;
const attached = (promise: string, handler: "then" | "catch", handle: string) =>
  handler === "then" ? `${promise}.then(value => value, ${handle})` : `${promise}.catch(${handle})`;

export function generateAtTheEndOfTheStack(needs: string, promise: string, handler: "then" | "catch") {
  return `${judge}
${needs}
let reached = 0;
function descend(depth, last) {
reached++;
return depth > 0 ? descend(depth - 1, last) + 1 : last();
}
let n = 0;
const last = () => {
${attached(promise, handler, "error => judge(error)")};
return 0;
};
let limit = 0;
let goal = 1e9;
for (n = 0; n <= 500; n++) {
reached = 0;
try {
descend(goal, last);
} catch (error) {
judge(error);
}
if (n === 0) limit = reached;
goal = limit + 20 - n;
}
await new Promise(resolve => setTimeout(resolve, 20));
${verdict}
`;
}

export function generateInAFullHeap(needs: string, promise: string, handler: "then" | "catch") {
  return `${judge}
${needs}
let kept = [];
let isFull = false;
const handle = error => {
kept = [];
isFull = true;
judge(error);
};
for (let round = 0; round < 2; round++) {
isFull = false;
try {
for (let n = 0; n < 600000 && !isFull; n++) {
kept.push(${attached(promise, handler, "handle")});
if (n % 4096 === 0) await null;
}
} catch (error) {
handle(error);
}
await null;
kept = [];
}
${verdict}
`;
}
