// Native code asks for built-in JavaScript by number: console.write, process.stdout, the printer of warnings, require() and so on.
// An executable holds only what its program can make native code ask for. Each program here reaches one of them by one road.
import { describePrograms, type Program } from "./programs-by-use";

const wasm =
  "[0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 127, 3, 2, 1, 0, 7, 5, 1, 1, 102, 0, 0, 10, 6, 1, 4, 0, 65, 42, 11]";

const inspected = `const inspected = { [Symbol.for("nodejs.util.inspect.custom")]: (depth, options, inspect) => "inspected " + inspect([depth]) };`;

const programs: Record<string, Program> = {
  "console.write": { source: `console.write("one ", "two\\n");` },
  "console.write through a variable": {
    source: `const everything = console; everything["wri" + "te"]("computed\\n");`,
  },
  "for await of console": {
    source: `for await (const line of console) { console.log("read", line); if (line === "second") break; }`,
    stdin: "first\nsecond\nthird\n",
  },
  "console[Symbol.asyncIterator]": {
    source: `const lines = console[Symbol.asyncIterator](); console.log((await lines.next()).value); await lines.return?.();`,
    stdin: "only\n",
  },
  "console.Console": { source: `new console.Console(process.stdout).log({ a: [1, { b: 2 }] }, "%s", 1);` },
  "Console of node:console": {
    source: `import { Console } from "node:console"; new Console({ stdout: process.stdout }).table([{ a: 1 }]);`,
  },
  "process.stdout and process.stderr": {
    source: `process.stdout.write("out\\n"); process.stderr.write("err\\n"); console.log(process.stdout.fd, process.stderr.fd);`,
  },
  "console._stdout": {
    source: `console._stdout.write("through the console\\n"); console._stderr.write("and its errors\\n");`,
  },
  "process.stdin": {
    source: `let all = ""; process.stdin.on("data", chunk => (all += chunk)).on("end", () => console.log(JSON.stringify(all)));`,
    stdin: "given\n",
  },
  "process.openStdin": {
    source: `let all = ""; process.openStdin().on("data", chunk => (all += chunk)).on("end", () => console.log(JSON.stringify(all)));`,
    stdin: "given\n",
  },
  "process._rawDebug": { source: `process._rawDebug("%s and %o", "text", { a: 1 });` },
  "process.loadEnvFile": {
    source: `process.loadEnvFile("some.env"); console.log(process.env.FROM_THE_FILE);`,
    files: { "some.env": "FROM_THE_FILE=yes\n" },
  },
  "process.finalization": {
    source: `const held = {}; process.finalization.register(held, () => console.log("at exit")); console.log(typeof process.finalization.unregister);`,
  },
  "process.allowedNodeEnvironmentFlags": {
    source: `console.log(process.allowedNodeEnvironmentFlags.has("--max-old-space-size"), process.allowedNodeEnvironmentFlags.has("--nothing"));`,
  },
  "process.env": {
    source: `process.env.MADE_HERE = "1"; console.log(process.env.MADE_HERE, "MADE_HERE" in process.env, delete process.env.MADE_HERE, process.env.MADE_HERE);`,
  },
  "process.nextTick": {
    source: `process.nextTick((...all) => console.log("tick", ...all), 1, 2, 3, 4, 5); console.log("first");`,
  },
  "a tick that native code queues": {
    source: `process.on("uncaughtException", error => console.log("caught", error.message)); const target = new EventTarget(); target.addEventListener("x", () => { throw new Error("in a listener"); }); target.dispatchEvent(new Event("x")); console.log("dispatched");`,
  },
  "a warning from native code": {
    source: `clearTimeout(setTimeout(() => {}, 2 ** 31)); await new Promise(resolve => setTimeout(resolve, 20)); console.log("done");`,
  },
  "process.emitWarning": {
    source: `process.emitWarning("said", "CustomWarning", "W1"); await new Promise(resolve => setTimeout(resolve, 20)); console.log("done");`,
  },
  "process.send and a message": {
    source: `process.on("message", message => { console.log("got", JSON.stringify(message)); process.disconnect(); }); process.send({ hello: 1 });`,
    ipc: "json",
  },
  "process.channel": {
    source: `console.log(typeof process.channel, typeof process.channel?.unref, process.connected); process.channel?.unref();`,
    ipc: "json",
  },
  "process.channel without a parent that listens": {
    source: `console.log(process.channel, process.connected, typeof process.send);`,
  },
  "messages with buffers": {
    source: `process.on("message", message => { console.log("got", message.constructor.name, [...message.bytes].join()); process.disconnect(); }); process.send({ bytes: new Uint8Array([1, 2, 3]) });`,
    ipc: "advanced",
  },
  "a message that only arrives, for a listener whose event is computed": {
    source: `process.on(["mess", "age"].join(""), message => { console.log("got", JSON.stringify(message)); process.exit(0); });`,
    ipc: "json",
    greeting: { hello: 2 },
  },
  "a message with buffers that only arrives": {
    source: `process.once("message", message => { console.log("got", message.constructor.name, [...message.bytes].join()); process.exit(0); });`,
    ipc: "advanced",
    greeting: { bytes: new Uint8Array([1, 2, 3]) },
  },
  "a message for a listener added by another name": {
    source: `process.prependOnceListener("message", message => { console.log("got", JSON.stringify(message)); process.exit(0); });`,
    ipc: "json",
    greeting: { hello: 3 },
  },
  "a parent that gets a message with buffers": {
    source: `const env = { ...process.env }; delete env.BUN_JSC_crashIfInterpreterIsUsed; const child = Bun.spawn({ cmd: [process.env.PLAIN_BUN, "child.mjs"], env, serialization: "advanced", stdio: ["ignore", "inherit", "inherit"], ipc(message) { console.log("got", message.constructor.name, [...message.bytes].join()); child.disconnect(); } }); console.log(await child.exited);`,
    files: { "child.mjs": `process.send({ bytes: new Uint8Array([4, 5]) });` },
  },
  "Bun.peek": {
    source: `console.log(Bun.peek(Promise.resolve(1)), Bun.peek.status(new Promise(() => {})), Bun.peek(2));`,
  },
  "peek imported from bun": { source: `import { peek } from "bun"; console.log(peek(Promise.resolve("imported")));` },
  "Bun.$": { source: `console.log((await Bun.$\`echo shell\`.text()).trim());` },
  "$ imported from bun": { source: `import { $ } from "bun"; console.log((await $\`echo imported\`.text()).trim());` },
  "Bun.Glob": {
    source: `const glob = new Bun.Glob("*.txt"); console.log([...glob.scanSync(".")].sort().join()); const found = []; for await (const file of glob.scan(".")) found.push(file); console.log(found.sort().join());`,
    files: { "a.txt": "", "b.txt": "", "c.md": "" },
  },
  "WebAssembly.instantiateStreaming of a stream": {
    source: `const bytes = new Uint8Array(${wasm}); const body = new ReadableStream({ start(controller) { controller.enqueue(bytes.slice(0, 10)); controller.enqueue(bytes.slice(10)); controller.close(); } }); const { instance } = await WebAssembly.instantiateStreaming(new Response(body, { headers: { "content-type": "application/wasm" } })); console.log(typeof instance.exports.f);`,
  },
  // With --aot no bundler links the require() calls of a CommonJS program: `module`, `require.main` and `require.cache` are what they are under `bun run`.
  "require of a file": {
    name: "main.cjs",
    source: `console.log(require("./other.cjs").value, typeof require, typeof module.require);`,
    files: { "other.cjs": "exports.value = 'required';" },
    aheadOfTime: "required function function\n",
  },
  "require.resolve": {
    name: "main.cjs",
    source: `console.log(require.resolve("./other.cjs").endsWith("other.cjs"), typeof require.resolve.paths);`,
    files: { "other.cjs": "" },
  },
  "require.main": {
    name: "main.cjs",
    source: `console.log(require.main === module, typeof require.main);`,
    aheadOfTime: "true object\n",
  },
  "module.require": {
    name: "main.cjs",
    source: `console.log(module.require("node:path").sep === require("node:path").sep);`,
  },
  "require handed on": {
    name: "main.cjs",
    source: `const os = require("node:os"); const load = name => [require].map(one => one(name))[0]; console.log(typeof load("node:os").EOL, load("node:os") === os);`,
  },
  "import.meta.require": { source: `console.log(typeof import.meta.require("node:path").join);` },
  "createRequire": {
    source: `import { createRequire } from "node:module"; const require = createRequire(import.meta.url); console.log(typeof require("node:os").EOL, typeof require.resolve);`,
  },
  "an ES module required": {
    name: "main.cjs",
    source: `console.log(require("./other.mjs").value);`,
    files: { "other.mjs": "export const value = 'from a module';" },
  },
  "Module.wrapper, _extensions and _initPaths": {
    name: "main.cjs",
    source: `const Module = require("node:module"); console.log(Module.wrapper.length, Module.wrap("x").length > 1, Object.keys(Module._extensions).sort().join(), typeof Module._initPaths()); console.log(Array.isArray(Module.globalPaths));`,
  },
  "watch of node:fs/promises": {
    source: `import { watch } from "node:fs/promises"; const stop = new AbortController(); setTimeout(() => stop.abort(), 30); try { for await (const _ of watch(".", { signal: stop.signal })); } catch (error) { console.log(error.name); }`,
  },
  "Buffer": {
    source: `const bytes = Buffer.from("abc"); console.log(JSON.stringify(bytes), bytes.parent === bytes.buffer, typeof bytes.offset, Buffer.isBuffer(bytes), Buffer.from({ type: "Buffer", data: [1] })[0], Buffer.from(new String("s")).length);`,
  },
  "a Buffer that native code makes": {
    source: `const digest = new Bun.CryptoHasher("sha1").update("a").digest(); console.log(JSON.stringify(digest).length, digest.parent === digest.buffer, digest.constructor.isBuffer(digest), digest.constructor.from("b").length);`,
  },
  "a custom inspector": {
    source: `console.log({ [Symbol.for("nodejs.util.inspect.custom")](depth, options, inspect) { return inspect({ depth, stylized: options.stylize("x", "string") }); } });`,
  },
  "a custom inspector by Bun.inspect.custom": {
    source: `console.log(Bun.inspect({ [Bun.inspect.custom]() { return "mine"; } }));`,
  },
  "a custom inspector in what is thrown and printed": {
    source: `try { throw { [Symbol.for("nodejs.util.inspect.custom")]: (_, __, inspect) => "thrown " + inspect([1]) }; } catch (error) { console.error(error); console.log("done"); }`,
  },
  "console.log handed on": { source: `${inspected} [inspected].forEach(console.log);` },
  "console.log applied and called": {
    source: `${inspected} console.log.apply(console, [inspected]); console.log.call(null, inspected); Reflect.apply(console.log, console, [inspected]);`,
  },
  "console.log taken out of console": {
    source: `${inspected} const { log, error: complain } = console; log(inspected); complain(inspected);`,
  },
  "console.log bound": { source: `${inspected} const log = console.log.bind(console, "bound"); log(inspected);` },
  "console.error as the handler of a rejection": {
    source: `${inspected} await Promise.reject(inspected).catch(console.error); await Promise.resolve(inspected).then(console.info);`,
  },
  "console.log of spread arguments": { source: `${inspected} const all = ["text", inspected]; console.log(...all);` },
  "console.log with a format": {
    source: `${inspected} console.log("%o and %O and %s and %j", inspected, inspected, inspected, inspected);`,
  },
  "the other methods of console": {
    source: `${inspected} console.dir(inspected); console.table([inspected]); console.assert(false, inspected); console.group(inspected); console.warn(inspected); console.groupEnd(); console.debug(inspected); console.info({ nested: [inspected] });`,
  },
  "console through the global object": {
    source: `${inspected} globalThis.console.log(inspected); globalThis["console"]["log"](inspected); self.console.log(inspected);`,
  },
  "console in a variable": {
    source: `${inspected} const output = console; output.log(inspected); const pick = name => output[name]; pick("lo" + "g")(inspected);`,
  },
  "console replaced": {
    source: `${inspected} const original = console; globalThis.console = { log: value => original.log("replaced", value) }; console.log(inspected);`,
  },
  "a result that is printed": {
    source: `${inspected} const make = () => inspected; console.log(make()); console.log(await Promise.resolve(inspected)); console.log(inspected ?? "nothing", true && inspected, (0, inspected));`,
  },
  "a host object's own inspector, called by hand": {
    source: `const custom = Symbol.for("nodejs.util.inspect.custom"); console.log(String(new URLSearchParams("a=1&b=2")[custom](2, {})), String(new URL("https://example.com/a")[custom](2, {})).length > 20);`,
  },
  "a host object's own inspector, found by reflection": {
    source: `function print(object, key) { try { console.log(String(object[key](2, {}))); } catch (error) { console.log(error.constructor.name, error.message.startsWith("Cannot use ")); } }
const [custom] = Object.getOwnPropertySymbols(URLSearchParams.prototype).filter(symbol => symbol.description === "nodejs.util.inspect.custom"); print(new URLSearchParams("a=1"), custom);
const found = Reflect.ownKeys(ReadableStream.prototype).find(key => typeof key === "symbol" && key.description === "nodejs.util.inspect.custom"); print(new ReadableStream(), found);
console.log("goes on");`,
  },
  "a custom inspector in what nobody catches": {
    source: `throw { [Symbol.for("nodejs.util.inspect.custom")]() { return "not asked"; } };`,
    exitCode: 1,
  },
  "a URL that nobody catches": { source: `Promise.reject(new URL("https://example.com/a?b=c"));`, exitCode: 1 },
  "a URL printed": { source: `console.log(new URL("https://example.com/a?b=c"), [new URLSearchParams("a=1")]);` },
  "a stream printed": {
    source: `console.log(new ReadableStream(), new Response("x").body, new TextDecoderStream().readable);`,
  },
  "a value of unknown type printed": {
    source: `function show(value) { console.log(value); } show(JSON.parse('{"a":[1,{"b":null}]}')); show(new URL("file:///x"));`,
  },
  "the promisified timers by their symbol": {
    source: `const custom = Symbol.for("nodejs.util.promisify.custom"); console.log(typeof setTimeout[custom], typeof setInterval[custom], typeof setImmediate[custom]); console.log(await setTimeout[custom](1, "value"));`,
  },
  "the promisified timers by a symbol that is computed": {
    source: `const custom = Symbol.for(["nodejs", "util", "promisify", "custom"].join(".")); console.log(await setImmediate[custom]("value"));`,
  },
  "a timer function spread": {
    source: `const copy = { ...setTimeout }; const [custom] = Object.getOwnPropertySymbols(copy); console.log(String(custom), await copy[custom](1, "spread"));`,
  },
  "a timer function handed on": {
    source: `function describe(timer) { return Object.values(Object.getOwnPropertyDescriptors(Object.assign({}, timer))).length + Reflect.ownKeys(Object.assign({}, timer)).length; } console.log(describe(setInterval), describe(setImmediate));`,
  },
  "util.promisify of a timer": {
    source: `import { promisify } from "node:util"; console.log(await promisify(setTimeout)(1, "promisified"));`,
  },
  "Bun.build with a plugin": {
    source: `const built = await Bun.build({ entrypoints: ["./entry.js"], plugins: [{ name: "text", setup(build) { build.onResolve({ filter: /^virtual$/ }, () => ({ path: "virtual", namespace: "made" })); build.onLoad({ filter: /.*/, namespace: "made" }, () => ({ contents: "export default 'from a plugin'", loader: "js" })); } }] }); console.log(built.success, (await built.outputs[0].text()).includes("from a plugin"));`,
    files: { "entry.js": `import text from "virtual"; console.log(text);` },
  },
};

describePrograms("what native code asks for is in the executable", programs);
