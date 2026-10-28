// The programs of ways-into-library-modules that are not written by hand. `bun test/aot/generate.ts ways-into-library-modules <where>` writes them.
// EVERY WAY TO REACH A FUNCTION OF A node: MODULE THAT NO REACHED CODE CALLS. An executable holds of Bun's library what the program reaches: `import { a } from "node:x"` reaches a alone where nothing in the program can get at the module whole.
// Each program imports ONE name of a module, uses it, gets at ANOTHER member of the same module by one way, under a name that is put together at run time, and CALLS OR CONSTRUCTS it (typeof a stub is "function" too).
// ONE MODULE, ONE MEMBER AND ONE WAY A PROGRAM. Plain Bun is the reference.
import { programsOf, type WrittenProgram } from "../generate";

/** By the path below the folder of programs. */
const filesWritten: Record<string, string> = {};

// module -> (the name that is imported, its use, [(the other member, its use with F for it)])
const MODULES: Record<string, [string, string, [string, string][]]> = {
  path: ["join", 'join("a", "b").length', [["basename", 'F("/a/b.txt")'], ["relative", 'F("/a/b", "/a/c")']]],
  url: ["fileURLToPath", 'fileURLToPath("file:///C:/a/b").slice(-1)', [["parse", 'F("http://host/path?x=1").pathname'], ["Url", 'new F().parse("http://host/path").host'], ["format", 'F({ protocol: "http", host: "host", pathname: "/p" })']]],
  util: ["format", 'format("%s", 1)', [["inspect", "F({ a: 1 })"], ["isDeepStrictEqual", "F([1], [1])"], ["promisify", "await F(callback => callback(null, 5))()"]]],
  querystring: ["escape", 'escape("a b")', [["parse", 'F("a=1&b=2").b'], ["stringify", "F({ a: 1 })"]]],
  events: ["once", "typeof once", [["EventEmitter", '(emitter => (emitter.on("x", value => seen.push(value)), emitter.emit("x", 5), seen.join()))(new F())'], ["getEventListeners", 'F(new EventTarget(), "x").length']]],
  stream: ["finished", "typeof finished", [["PassThrough", "new F().writable"], ["Readable", '(await F.from(["a", "b"]).toArray()).join()']]],
  os: ["EOL", 'EOL.endsWith("\\n") ? 1 : 0', [["endianness", "F()"], ["platform", "typeof F()"]]],
  fs: ["existsSync", 'existsSync("/")', [["statSync", 'F("/").isDirectory()'], ["readdirSync", 'Array.isArray(F("/"))']]],
  assert: ["ok", "ok(true)", [["deepStrictEqual", "F([1], [1])"], ["AssertionError", 'new F({ message: "m" }).code']]],
  zlib: ["gzipSync", 'gzipSync("a").length > 0', [["gunzipSync", 'F(gzipSync("text")).toString()'], ["createGzip", "typeof F().write"]]],
  crypto: ["randomUUID", "randomUUID().length", [["createHash", 'F("sha1").update("a").digest("hex")'], ["timingSafeEqual", 'F(Buffer.from("a"), Buffer.from("a"))']]],
  readline: ["clearLine", "typeof clearLine", [["Interface", "typeof F.prototype.question"], ["createInterface", '(lines => (lines.close(), lines.closed))(F({ input: new (await import("node:stream")).PassThrough() }))']]],
  http: ["STATUS_CODES", "STATUS_CODES[200]", [["Agent", "new F().maxSockets"], ["validateHeaderName", 'F("x")']]],
  net: ["isIP", 'isIP("1.1.1.1")', [["Socket", "new F().destroyed"], ["isIPv6", 'F("::1")']]],
  async_hooks: ["executionAsyncId", "typeof executionAsyncId()", [["AsyncLocalStorage", "(storage => storage.run(5, () => storage.getStore()))(new F())"], ["AsyncResource", 'new F("kind").runInAsyncScope(() => 5)']]],
  buffer: ["kMaxLength", "typeof kMaxLength", [["Buffer", 'F.from("a").toString("hex")'], ["isUtf8", "F(new Uint8Array([97]))"]]],
  diagnostics_channel: ["hasSubscribers", 'hasSubscribers("x")', [["channel", 'F("x").name']]],
  string_decoder: ["StringDecoder", "typeof StringDecoder", [["StringDecoder", 'new F("utf8").write(Buffer.from("a"))']]],
};
const NAME = 'const name = ["node:", "@X"].join("");\n';
const GET = 'const loader = ["get", "Builtin", "Module"].join("");\n';
// way -> (what the first line says, lines at the head of the file, the lines that make `whole`, the extension, other files)
const WAYS: Record<string, [string, string, string, string, Record<string, string>]> = {
  "a-namespace-import": ["a namespace import", 'import * as whole from "node:@X";\n', "", "js", {}],
  "the-entries-of-a-namespace-import": ["the entries of a namespace import", 'import * as space from "node:@X";\n', "const whole = Object.fromEntries(Object.entries(space));\n", "js", {}],
  "a-default-import": ["the default import", 'import whole from "node:@X";\n', "", "js", {}],
  "the-default-import-by-name": ["the export named default", 'import { default as whole } from "node:@X";\n', "", "js", {}],
  "a-dynamic-import": ["import() of the module's name", "", 'const whole = await import("node:@X");\n', "js", {}],
  "a-dynamic-import-of-a-computed-name": ["import() of a name that is put together at run time", "", NAME + "const whole = await import(name);\n", "js", {}],
  "the-default-of-a-dynamic-import": ["the default export of import()", "", 'const whole = (await import("node:@X")).default;\n', "js", {}],
  require: ["require of the module's name", "", 'const whole = require("node:@X");\n', "js", {}],
  "require-of-a-computed-name": ["require of a name that is put together at run time", "", NAME + "const whole = require(name);\n", "js", {}],
  "require-without-the-prefix": ["require of the module's name without node:", "", 'const whole = require("@X");\n', "js", {}],
  "import-meta-require": ["import.meta.require", "", NAME + "const whole = import.meta.require(name);\n", "js", {}],
  "create-require": ["a function made by createRequire", 'import { createRequire } from "node:module";\n', NAME + "const whole = createRequire(import.meta.url)(name);\n", "js", {}],
  "module-prototype-require": ["Module.prototype.require", 'import Module from "node:module";\n', NAME + 'const whole = Module.prototype.require.call(new Module("x"), name);\n', "js", {}],
  "create-require-bound": ["a function made by createRequire, bound", 'import { createRequire } from "node:module";\n', NAME + "const whole = createRequire(import.meta.url).bind(null)(name);\n", "js", {}],
  "require-bound": ["require, bound", "", NAME + "const whole = require.bind(null)(name);\n", "js", {}],
  "require-by-call": ["require, called by call", "", NAME + "const whole = require.call(null, name);\n", "js", {}],
  "require-by-apply": ["require, called by apply", "", NAME + "const whole = require.apply(null, [name]);\n", "js", {}],
  "require-as-a-value": ["require, taken as a value", "", NAME + "const load = require;\nconst whole = load(name);\n", "js", {}],
  "require-handed-to-map": ["require, handed to Array.prototype.map", "", NAME + "const whole = [name].map(require)[0];\n", "js", {}],
  "import-meta-require-bound": ["import.meta.require, bound", "", NAME + "const whole = import.meta.require.bind(null)(name);\n", "js", {}],
  "get-builtin-module-by-call": ["process.getBuiltinModule, called by call", "", NAME + "const whole = process.getBuiltinModule.call(process, name);\n", "js", {}],
  "get-builtin-module-by-apply": ["process.getBuiltinModule, called by apply", "", NAME + "const whole = process.getBuiltinModule.apply(process, [name]);\n", "js", {}],
  "get-builtin-module-by-call-of-call": ["process.getBuiltinModule, called by Function.prototype.call.call", "", NAME + "const whole = Function.prototype.call.call(process.getBuiltinModule, process, name);\n", "js", {}],
  "get-builtin-module-in-a-sequence": ["process.getBuiltinModule, the last of a sequence of expressions", "", NAME + "const whole = (0, process.getBuiltinModule)(name);\n", "js", {}],
  "get-builtin-module-by-an-optional-call": ["process.getBuiltinModule, called by an optional chain", "", NAME + "const whole = process?.getBuiltinModule?.(name);\n", "js", {}],
  "get-builtin-module-under-a-constant-key": ["process.getBuiltinModule, written with brackets", "", NAME + 'const whole = process["getBuiltinModule"](name);\n', "js", {}],
  "get-builtin-module-through-another-name": ["getBuiltinModule of a variable that holds process", "", NAME + "const host = process;\nconst whole = host.getBuiltinModule(name);\n", "js", {}],
  "get-builtin-module-by-its-descriptor": ["process.getBuiltinModule, taken out of its descriptor", "", NAME + 'const holder = Object.hasOwn(process, "getBuiltinModule") ? process : Object.getPrototypeOf(process);\nconst whole = Object.getOwnPropertyDescriptor(holder, "getBuiltinModule").value(name);\n', "js", {}],
  "get-builtin-module-behind-a-proxy": ["a proxy of process.getBuiltinModule", "", NAME + "const whole = new Proxy(process.getBuiltinModule, {})(name);\n", "js", {}],
  "get-builtin-module-as-a-reaction": ["process.getBuiltinModule, handed to then", "", NAME + "const whole = await Promise.resolve(name).then(process.getBuiltinModule);\n", "js", {}],
  "get-builtin-module-in-an-object": ["process.getBuiltinModule, stored in an object of the program", "", NAME + "const whole = { load: process.getBuiltinModule }.load(name);\n", "js", {}],
  "get-builtin-module-as-an-argument": ["process.getBuiltinModule, handed to a function of the program", "", NAME + "const whole = (load => load(name))(process.getBuiltinModule);\n", "js", {}],
  "get-builtin-module-as-a-default": ["process.getBuiltinModule, the default of a parameter", "", NAME + "function take(load = process.getBuiltinModule) {\n  return load(name);\n}\nconst whole = take();\n", "js", {}],
  "module-require-bound-in-commonjs": ["module.require, bound, in a CommonJS file", "", NAME + "const whole = module.require.bind(module)(name);\n", "cjs", {}],
  "require-bound-in-commonjs": ["require, bound, in a CommonJS file", "", NAME + "const whole = require.bind(null)(name);\n", "cjs", {}],
  "require-by-call-in-commonjs": ["require, called by call, in a CommonJS file", "", NAME + "const whole = require.call(null, name);\n", "cjs", {}],
  "get-builtin-module": ["process.getBuiltinModule", "", 'const whole = process.getBuiltinModule("node:@X");\n', "js", {}],
  "get-builtin-module-of-a-computed-name": ["process.getBuiltinModule of a name that is put together at run time", "", NAME + "const whole = process.getBuiltinModule(name);\n", "js", {}],
  "get-builtin-module-as-a-value": ["process.getBuiltinModule, taken as a value", "", NAME + "const load = process.getBuiltinModule;\nconst whole = load(name);\n", "js", {}],
  "get-builtin-module-by-a-pattern": ["process.getBuiltinModule, taken by a destructuring pattern", "", NAME + "const { getBuiltinModule } = process;\nconst whole = getBuiltinModule(name);\n", "js", {}],
  "get-builtin-module-under-a-computed-key": ["process.getBuiltinModule, found under a key that is put together at run time", "", NAME + GET + "const whole = process[loader](name);\n", "js", {}],
  "get-builtin-module-by-reflect-get": ["process.getBuiltinModule, found by Reflect.get", "", NAME + 'const whole = Reflect.get(process, "getBuiltinModule")(name);\n', "js", {}],
  "get-builtin-module-by-reflect-apply": ["process.getBuiltinModule, applied by Reflect.apply", "", NAME + "const whole = Reflect.apply(process.getBuiltinModule, process, [name]);\n", "js", {}],
  "get-builtin-module-bound": ["process.getBuiltinModule, bound", "", NAME + "const whole = process.getBuiltinModule.bind(process)(name);\n", "js", {}],
  "get-builtin-module-in-a-copy-of-process": ["process.getBuiltinModule, found in a spread of process", "", NAME + "const whole = { ...process }.getBuiltinModule(name);\n", "js", {}],
  "get-builtin-module-imported-by-name": ["getBuiltinModule, imported from node:process by name", 'import { getBuiltinModule } from "node:process";\n', NAME + "const whole = getBuiltinModule(name);\n", "js", {}],
  "get-builtin-module-of-the-imported-process": ["getBuiltinModule of the default import of node:process", 'import host from "node:process";\n', NAME + "const whole = host.getBuiltinModule(name);\n", "js", {}],
  "get-builtin-module-through-global-this": ["globalThis.process.getBuiltinModule", "", NAME + 'const whole = globalThis[["pro", "cess"].join("")].getBuiltinModule(name);\n', "js", {}],
  "get-builtin-module-handed-to-map": ["process.getBuiltinModule, handed to Array.prototype.map", "", NAME + "const whole = [name].map(process.getBuiltinModule)[0];\n", "js", {}],
  "a-module-of-the-program-that-exports-all-of-it": ["a module of the program that exports all of it again", 'import * as whole from "./all.js";\n', "", "js", { "all.js": 'export * from "node:@X";\n' }],
  "a-module-of-the-program-that-exports-its-namespace": ["a module of the program that exports its namespace", 'import { whole } from "./all.js";\n', "", "js", { "all.js": 'export * as whole from "node:@X";\n' }],
  "a-commonjs-file-that-hands-it-on": ["a CommonJS file of the program whose exports object it is", 'import whole from "./all.cjs";\n', "", "js", { "all.cjs": 'module.exports = require("node:@X");\n' }],
  "module-require-in-commonjs": ["module.require in a CommonJS file", "", NAME + "const whole = module.require(name);\n", "cjs", {}],
  "require-as-a-value-in-commonjs": ["require, taken as a value in a CommonJS file", "", NAME + "const load = require;\nconst whole = [name].map(load)[0];\n", "cjs", {}],
  "require-main-require-in-commonjs": ["require.main.require in a CommonJS file", "", NAME + "const whole = require.main.require(name);\n", "cjs", {}],
};
const TAIL = `const F = whole[key];
try {
  console.log("the other member:", String(@USE));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
`;
// The one name is imported from a module that ANOTHER LIBRARY MODULE, which the program reaches too, also reads by names: there the walk mixes the application's names with the library's.
// module -> (the name that is imported, its use, the other members, (the other library module, the name imported from it, its use))
const BESIDE: Record<string, [string, string, [string, string][], [string, string, string]]> = {
  util: [
    "format", 'format("%s", 1)', [["stripVTControlCharacters", 'F("\\u001b[1ma")'], ["callbackify", "typeof F(async () => 1)"], ["parseArgs", 'F({ args: ["-a"], options: { a: { type: "boolean", short: "a" } } }).values.a'], ["toUSVString", 'F("a")']],
    ["assert", "strictEqual", "strictEqual(1, 1)"],
  ],
  events: [
    "once", "typeof once", [["getMaxListeners", "F(new EventTarget())"], ["listenerCount", 'F(process, "no such event")'], ["addAbortListener", "typeof F(new AbortController().signal, () => {})[Symbol.dispose]"]],
    ["stream", "PassThrough", "new PassThrough().readable"],
  ],
  stream: [
    "finished", "typeof finished", [["isReadable", "F(null)"], ["getDefaultHighWaterMark", "F(false)"], ["Duplex", "new F({ read() {}, write(chunk, encoding, done) { done(); } }).readable"], ["Transform", "new F({ transform(chunk, encoding, done) { done(); } }).writable"]],
    ["zlib", "createGzip", "typeof createGzip().pipe"],
  ],
};
const TABLE: [string, [string, string, [string, string][]], [string, string, string] | undefined][] = [
  ...Object.entries(MODULES).map(([module, row]): (typeof TABLE)[number] => [module, row, undefined]),
  ...Object.entries(BESIDE).map(([module, [first, use, others, beside]]): (typeof TABLE)[number] => [module, [first, use, others], beside]),
];
for (const [module, [first, use, others], beside] of TABLE) {
  for (const [other, call] of others) {
    for (const [way, [says, head, make, extension, files]] of Object.entries(WAYS)) {
      const half = Math.max(1, Math.floor(other.length / 2));
      const line = "// One name of node:" + module + " is imported and used" + (beside ? ", and so is node:" + beside[0] + ", which reads node:" + module + " by names of its own" : "") + "; another, " + other + ", is found through " + says + " under a name that is put together at run time, and is used too.\n";
      let text;
      if (extension === "cjs") {
        if (call.includes("await ")) {
          continue;
        }
        text = line + "const { " + first + ' } = require("node:' + module + '");\n' + (beside ? "const { " + beside[1] + ' } = require("node:' + beside[0] + '");\n' : "");
      } else {
        text = line + "import { " + first + ' } from "node:' + module + '";\n' + (beside ? "import { " + beside[1] + ' } from "node:' + beside[0] + '";\n' : "") + head;
      }
      text += "const seen = [];\n" + 'console.log("the name that is imported:", String(' + use + "));\n" + (beside ? 'console.log("the other library module:", String(' + beside[2] + "));\n" : "") + 'const key = ["' + other.slice(0, half) + '", "' + other.slice(half) + '"].join("");\n' + make + TAIL.replaceAll("@USE", call);
      text = text.replaceAll("@X", module);
      const plain = beside ? other.replace(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/g, "-").toLowerCase() : other.replace(/[A-Z]/g, letter => "-" + letter.toLowerCase()).replace(/^-+|-+$/g, "").replaceAll("i-pv6", "ipv6");
      const name = module.replaceAll("_", "-") + "-" + plain + (beside ? "-beside-" + beside[0] : "") + "-through-" + way;
      if (Object.keys(files).length > 0) {
        filesWritten[name + "/main." + extension] = text;
        for (const [file, content] of Object.entries(files)) {
          filesWritten[name + "/" + file] = content.replaceAll("@X", module);
        }
      } else {
        filesWritten[name + "." + extension] = text;
      }
      // Its stored output is the refusal of a loader that the compiler did not see, and what the compiler sees is a result of flow.
      if (way === "get-builtin-module-under-a-computed-key") {
        filesWritten[name + ".json"] = '{ "skipInVariant": { "no-flow-results": "without the results of flow the loader answers, as under plain Bun" } }\n';
      }
    }
  }
}

// EVALUATED TEXT: what the text gets at is right, or it is refused aloud with one of the two documented messages ("'..' was not compiled into this executable because your code never calls it"):
// never another error, never another answer. The program says the same line in both cases, so plain Bun stays the reference.
const EXPECTED = {
  basename: "b.txt", relative: "../c", parse: undefined, Url: "host", format: "http://host/p", inspect: "{ a: 1 }", isDeepStrictEqual: "true", promisify: "5", stringify: "a=1", EventEmitter: "5",
  getEventListeners: "0", PassThrough: "true", Readable: "a,b", endianness: "LE", platform: "string", statSync: "true", readdirSync: "true", deepStrictEqual: "undefined", AssertionError: "ERR_ASSERTION",
  gunzipSync: "text", createGzip: "function", createHash: "86f7e437faa5a7fce15d1ddcb9eaeaea377667b8", timingSafeEqual: "true", Interface: "function", createInterface: "true", Agent: "Infinity",
  validateHeaderName: "undefined", Socket: "false", isIPv6: "true", AsyncLocalStorage: "5", AsyncResource: "5", Buffer: "61", isUtf8: "true", channel: "x", StringDecoder: "a",
};
const TEXTS: Record<string, [string, string]> = {
  "the-text-of-new-function": ["the text of new Function", 'new Function("name", "return process.getBuiltinModule(name)")(name)'],
  "the-text-of-function-called-without-new": ["the text of Function, called without new", 'Function("name", "return process.getBuiltinModule(name)")(name)'],
  "the-text-of-an-indirect-eval": ["the text of an indirect eval", '(0, eval)("process.getBuiltinModule")(name)'],
  "the-text-of-a-direct-eval": ["the text of a direct eval", 'eval("process.getBuiltinModule(name)")'],
  "the-text-of-the-constructor-of-a-function": ["text given to the constructor property of a function", '(() => {}).constructor("name", "return process.getBuiltinModule(name)")(name)'],
  "the-text-of-reflect-construct-of-function": ["text given to Reflect.construct of Function", 'Reflect.construct(Function, ["name", "return process.getBuiltinModule(name)"])(name)'],
  "the-text-of-an-async-function": ["text given to the constructor of async functions", 'await (async () => {}).constructor("name", "return process.getBuiltinModule(name)")(name)'],
  "an-import-in-the-text-of-new-function": ["import() in the text of new Function", 'await new Function("name", "return import(name)")(name)'],
  "the-text-of-run-in-this-context": ["text given to vm.runInThisContext", '(await import("node:vm")).runInThisContext("process.getBuiltinModule")(name)'],
  "the-text-of-a-script": ["the text of a vm.Script", 'new (await import("node:vm")).Script("process.getBuiltinModule").runInThisContext()(name)'],
};
for (const [module, [first, use, others]] of Object.entries(MODULES)) {
  for (const [other, call] of others) {
    // It warns on standard error where it runs, and a refusal does not.
    if (module === "url" && other === "parse") continue;
    const wanted = other === "parse" ? "2" : EXPECTED[other];
    for (const [way, [says, get]] of Object.entries(TEXTS)) {
      const half = Math.max(1, Math.floor(other.length / 2));
      let text = "// One name of node:" + module + " is imported and used; another, " + other + ", is found through " + says + ". What the text gets at answers right, or it is refused aloud: with no other error and no other answer.\n";
      text += "import { " + first + ' } from "node:' + module + '";\nconst seen = [];\nconsole.log("the name that is imported:", String(' + use + "));\n";
      text += 'const key = ["' + other.slice(0, half) + '", "' + other.slice(half) + '"].join("");\n' + NAME.replaceAll("@X", module) + "let told;\ntry {\n  const whole = " + get + ";\n  const F = whole[key];\n  const answer = String(" + call + ");\n";
      text += "  told = answer === " + JSON.stringify(wanted) + ' ? "right" : "ANOTHER ANSWER: " + answer;\n} catch (error) {\n  told = /was not compiled into this executable|Code generation from strings disallowed/.test(error.message) ? "refused aloud" : "threw " + error.constructor.name + ": " + error.message;\n}\n';
      text += 'console.log("the other member:", told === "right" || told === "refused aloud" ? "right, or refused aloud" : told);\n';
      const plain = other.replace(/[A-Z]/g, letter => "-" + letter.toLowerCase()).replace(/^-+|-+$/g, "").replaceAll("i-pv6", "ipv6");
      filesWritten[module.replaceAll("_", "-") + "-" + plain + "-through-" + way + ".js"] = text;
    }
  }
}

// A PACKAGE MARKED --external is interpreted at run time and loads what it likes.
const OUTSIDE: Record<string, [string, string, string, string]> = {
  "an-external-package-that-requires-it": ["a package marked --external, which requires the module by the name it is handed", "module.exports = name => require(name);\n", '{ "name": "outside", "version": "1.0.0", "main": "index.js" }\n', "take(name)"],
  "an-external-package-that-asks-process-for-it": ["a package marked --external, which asks process.getBuiltinModule for it", "module.exports = name => process.getBuiltinModule(name);\n", '{ "name": "outside", "version": "1.0.0", "main": "index.js" }\n', "take(name)"],
  "an-external-package-that-imports-it": ["a package marked --external, an ES module that imports it by the name it is handed", "export default name => import(name);\n", '{ "name": "outside", "version": "1.0.0", "type": "module", "main": "index.js" }\n', "await take(name)"],
};
for (const [module, [first, use, others]] of Object.entries(MODULES)) {
  for (const [other, call] of others) {
    for (const [way, [says, index, manifest, get]] of Object.entries(OUTSIDE)) {
      const half = Math.max(1, Math.floor(other.length / 2));
      const plain = other.replace(/[A-Z]/g, letter => "-" + letter.toLowerCase()).replace(/^-+|-+$/g, "").replaceAll("i-pv6", "ipv6");
      const name = module.replaceAll("_", "-") + "-" + plain + "-through-" + way;
      let text = "// One name of node:" + module + " is imported and used; another, " + other + ", is found through " + says + ", and is used too.\n";
      text += "import { " + first + ' } from "node:' + module + '";\nimport take from "outside";\nconst seen = [];\nconsole.log("the name that is imported:", String(' + use + "));\n";
      text += 'const key = ["' + other.slice(0, half) + '", "' + other.slice(half) + '"].join("");\n' + NAME.replaceAll("@X", module) + "const whole = " + get + ";\n" + TAIL.replaceAll("@USE", call);
      filesWritten[name + "/main.js"] = text;
      filesWritten[name + "/node_modules/outside/index.js"] = index;
      filesWritten[name + "/node_modules/outside/package.json"] = manifest;
      filesWritten[name + ".json"] = '{ "build": ["--external", "outside"], "skipInShell": "it loads an external package through the loader of Bun, which the jsc shell does not have" }\n';
    }
  }
}

export const programs = (): WrittenProgram[] => programsOf(filesWritten);
