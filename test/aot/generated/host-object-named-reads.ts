// Random CommonJS programs about reads and calls by name on every kind of object of the host and of the engine: process, process.env,
// require and its tables, module, Buffer, streams, URL, Headers, errors, proxies, arguments, boxed primitives, typed arrays, timers ..
// A site reads a name three times, so that whatever remembers answers has remembered this one. THEN THE ANSWER IS MADE ANOTHER
// without the site's knowing: an own value, an own getter, the own property deleted, a value | a getter | a deletion on the
// prototype, on the prototype's prototype, another prototype in between, no prototype, the object frozen, many properties added. Then
// the site reads twice more; beside each read stand `in` and, where the value can be called, a call by name.
//
// Each group of lines begins with one head, `<object> <name> / <alteration>`. A group whose alteration --aot does not allow says
// REFUSED and ends there.
import { Random } from "./python-random";

const head = [
  "\"use strict\";",
  "const show = v => { try { return v === undefined ? \"u\" : v === null ? \"null\" : typeof v === \"function\" ? \"fn\" : typeof v === \"object\" ? \"obj:\" + Object.prototype.toString.call(v).slice(8, -1) : typeof v + \":\" + String(v).slice(0, 40); } catch (e) { return \"?\" + e.name; } };",
  "const lines = []; const say = s => lines.push(s);",
  "const fs = require(\"fs\"), path = require(\"path\"), events = require(\"events\"), stream = require(\"stream\"), Module = require(\"module\"), os = require(\"os\"), util = require(\"util\"), crypto = require(\"crypto\"), { AsyncLocalStorage } = require(\"async_hooks\");",
  "const up = (o, n) => { for (let i = 0; i < n && o; i++) o = Object.getPrototypeOf(o); return o; };",
  "const alter = [",
  "  (o, n) => { Object.defineProperty(o, n, { value: \"own value\", writable: true, enumerable: true, configurable: true }); },",
  "  (o, n) => { Object.defineProperty(o, n, { get() { return \"own getter\"; }, configurable: true }); },",
  "  (o, n) => { if (!delete o[n]) throw new TypeError(\"not deleted\"); },",
  "  (o, n) => { Object.defineProperty(up(o, 1), n, { value: \"on the prototype\", writable: true, enumerable: true, configurable: true }); },",
  "  (o, n) => { Object.defineProperty(up(o, 1), n, { get() { return \"getter on the prototype\"; }, configurable: true }); },",
  "  (o, n) => { if (!delete up(o, 1)[n]) throw new TypeError(\"not deleted\"); },",
  "  (o, n) => { Object.defineProperty(up(o, 2), n, { value: \"two up\", writable: true, enumerable: true, configurable: true }); },",
  "  (o, n) => { Object.setPrototypeOf(o, Object.create(up(o, 1), { [n]: { value: \"in between\", configurable: true } })); },",
  "  (o, n) => { Object.setPrototypeOf(o, null); },",
  "  (o, n) => { o[n] = \"stored\"; },",
  "  (o, n) => { up(o, 1)[n] = \"stored on the prototype\"; },",
  "  (o, n) => { Object.freeze(o); },",
  "  (o, n) => { o[\"other\" + n] = 1; delete o[\"other\" + n]; },",
  "  (o, n) => { for (let i = 0; i < 70; i++) o[\"many\" + i] = i; },",
  "];",
  "const saved = (o, n) => { const all = []; for (let p = o, i = 0; p && i < 3; p = Object.getPrototypeOf(p), i++) all.push([p, Object.getOwnPropertyDescriptor(p, n)]); return [all, Object.getPrototypeOf(o)]; };",
  "const restore = (o, n, [all, proto]) => { try { if (Object.getPrototypeOf(o) !== proto) Object.setPrototypeOf(o, proto); } catch (e) {} for (const [p, d] of all) { try { if (d) Object.defineProperty(p, n, d); else delete p[n]; } catch (e) {} } };",
];

/** How an object is made, and the names that are asked of it. */
const objects: [maker: string, names: string[]][] = [
  ["process.env", ["XYZ_A", "XYZ_B", "HOME", "xyz_lower"]],
  ["Bun.env", ["XYZ_C", "HOME"]],
  ["process", ["title", "argv0", "noDeprecation", "throwDeprecation", "traceDeprecation", "xyz", "exitCode", "debugPort", "execArgv", "argv", "env2", "platform", "pid", "version", "arch"]],
  ["require.extensions", [".xyza", ".xyzb", ".js2"]],
  ["Module._extensions", [".xyzc"]],
  ["require.cache", ["xyzkey", "/nowhere/x.js"]],
  ["module", ["id", "loaded", "filename2", "paths", "children", "parent", "xyz", "exports"]],
  ["require", ["main2", "xyz", "cache2"]],
  ["Error", ["stackTraceLimit", "xyz", "prepareStackTrace2"]],
  ["globalThis", ["xyzglobal", "onerror", "name", "xyzother", "self2"]],
  ["new URL(\"http://a.example/p?q=1#h\")", ["href", "pathname", "search", "hash", "host", "hostname", "port", "protocol", "username", "password", "origin", "searchParams", "xyz"]],
  ["new URLSearchParams(\"a=1\")", ["size", "xyz", "a"]],
  ["new Headers({ a: \"1\" })", ["a", "xyz", "count"]],
  ["new Request(\"http://a.example/\")", ["url", "method", "headers", "body", "xyz", "signal", "cache", "mode"]],
  ["new Response(\"x\", { status: 201 })", ["status", "ok", "statusText", "headers", "body", "xyz", "url", "type"]],
  ["new Blob([\"x\"], { type: \"a/b\" })", ["size", "type", "name", "xyz", "lastModified"]],
  ["new File([\"x\"], \"n.txt\")", ["name", "size", "lastModified2", "xyz"]],
  ["new AbortController()", ["signal", "xyz"]],
  ["new AbortController().signal", ["onabort", "aborted", "reason", "xyz"]],
  ["new EventTarget()", ["xyz", "onfoo"]],
  ["new Event(\"x\", { cancelable: true })", ["cancelBubble", "returnValue", "type", "xyz", "defaultPrevented", "target"]],
  ["new MessageChannel().port1", ["onmessage", "xyz"]],
  ["new TextDecoder()", ["encoding", "fatal", "ignoreBOM", "xyz"]],
  ["new TextEncoder()", ["encoding", "xyz"]],
  ["Buffer.alloc(4)", ["length", "parent", "offset", "byteLength", "buffer", "xyz", "byteOffset"]],
  ["new Uint8Array(4)", ["length", "byteLength", "xyz", "buffer"]],
  ["new ArrayBuffer(8)", ["byteLength", "xyz", "maxByteLength", "resizable"]],
  ["new DataView(new ArrayBuffer(8))", ["byteLength", "xyz"]],
  ["Bun", ["xyz", "main2", "argv2", "version"]],
  ["console", ["xyz", "log2", "_stdout2"]],
  ["performance", ["timeOrigin", "xyz", "onresourcetimingbufferfull"]],
  ["navigator", ["userAgent", "xyz", "hardwareConcurrency", "platform"]],
  ["fs.statSync(\".\")", ["size", "mode", "xyz", "mtimeMs", "mtime", "dev"]],
  ["new events()", ["_events", "_eventsCount", "_maxListeners", "domain", "xyz"]],
  ["new stream.Readable({ read() {} })", ["destroyed", "readable", "readableFlowing", "xyz", "readableHighWaterMark", "_readableState2"]],
  ["new stream.Writable({ write() {} })", ["destroyed", "writable", "xyz", "writableLength"]],
  ["new stream.PassThrough()", ["allowHalfOpen", "xyz", "destroyed"]],
  ["process.stdout", ["xyz", "columns2", "_type2"]],
  ["process.versions", ["node", "xyz", "bun"]],
  ["process.release", ["name", "xyz"]],
  ["process.config", ["xyz", "variables"]],
  ["process.features", ["xyz", "typescript", "inspector"]],
  ["process.memoryUsage", ["rss", "xyz", "name", "length"]],
  ["process.hrtime", ["bigint", "xyz"]],
  ["os.constants", ["xyz", "signals", "UV_UDP_REUSEADDR"]],
  ["os.constants.signals", ["SIGINT", "xyz"]],
  ["new AsyncLocalStorage()", ["xyz", "enabled2"]],
  ["crypto.createHash(\"md5\")", ["xyz", "_options2"]],
  ["util.inspect", ["defaultOptions2", "custom", "xyz", "colors2"]],
  ["util.inspect.defaultOptions", ["depth", "xyz", "colors"]],
  ["setTimeout(() => {}, 100000)", ["_onTimeout", "_repeat", "_idleTimeout", "xyz"]],
  ["setImmediate(() => {})", ["_onImmediate", "xyz"]],
  ["new Map([[1, 2]])", ["size", "xyz", "get"]],
  ["new Set([1])", ["size", "xyz", "has"]],
  ["new WeakMap()", ["xyz"]],
  ["new WeakRef({})", ["xyz"]],
  ["new Date(0)", ["xyz", "getTime"]],
  ["/a/g", ["lastIndex", "source", "flags", "global", "xyz"]],
  ["Promise.resolve(1)", ["then", "xyz", "constructor"]],
  ["new String(\"abc\")", ["length", "xyz", "0x"]],
  ["new Number(5)", ["xyz"]],
  ["Object(Symbol(\"d\"))", ["description", "xyz"]],
  ["Object(10n)", ["xyz"]],
  ["function named(a, b) {}", ["name", "length", "prototype", "xyz", "displayName"]],
  ["(a => a)", ["name", "length", "prototype", "xyz"]],
  ["class K { static s = 1; m() {} }", ["name", "length", "prototype", "s", "xyz"]],
  ["(class K2 { m() {} }).prototype", ["m", "constructor", "xyz"]],
  ["(function () {}).bind(null)", ["name", "length", "xyz"]],
  ["async function af() {}", ["name", "xyz", "prototype"]],
  ["function* gf() {}", ["name", "prototype", "xyz"]],
  ["(function* () {})()", ["xyz", "next"]],
  ["(function () { return arguments; })(1, 2)", ["length", "callee2", "xyz"]],
  ["new Error(\"m\")", ["stack", "message", "cause", "name", "xyz", "line", "column", "sourceURL"]],
  ["new TypeError(\"m\", { cause: 1 })", ["stack", "message", "cause", "xyz"]],
  ["new AggregateError([1], \"m\")", ["errors", "xyz"]],
  ["new Proxy({ a: 1 }, { set(t, k, v) { say(\"  trap set \" + String(k)); t[k] = v; return true; }, defineProperty(t, k, d) { say(\"  trap define \" + String(k)); return Reflect.defineProperty(t, k, d); } })", ["a", "xyz"]],
  ["[1, 2, 3]", ["length", "xyz", "map"]],
  ["Object.create(null)", ["xyz", "toString", "constructor"]],
  ["Object.create({ set xyz(v) { say(\"  inherited setter\"); }, get xyz() { return \"got\"; }, ro: 1 })", ["xyz", "ro", "other"]],
  ["Object.create(Object.freeze({ xyz: 1, other: 2 }))", ["xyz", "other", "third"]],
  ["Object.freeze({ xyz: 1 })", ["xyz", "other"]],
  ["Object.seal({ xyz: 1 })", ["xyz", "other"]],
  ["Object.preventExtensions({ xyz: 1 })", ["xyz", "other"]],
  ["Object.defineProperty({}, \"xyz\", { value: 1, writable: true, enumerable: false, configurable: true })", ["xyz"]],
  ["Object.defineProperty({}, \"xyz\", { value: 1, writable: false, configurable: true })", ["xyz"]],
  ["JSON.parse('{\"xyz\":1,\"b\":2}')", ["xyz", "b", "c"]],
  ["structuredClone({ xyz: 1 })", ["xyz", "b"]],
  ["Math", ["PI", "xyz", "max"]],
  ["JSON", ["xyz", "parse2"]],
  ["Reflect", ["xyz"]],
  ["Intl", ["xyz"]],
  ["new Intl.NumberFormat(\"en\")", ["xyz", "format"]],
  ["Symbol", ["iterator", "xyz"]],
  ["Object", ["xyz", "keys2", "prototype"]],
  ["Array", ["xyz", "prototype", "from2"]],
  ["Function.prototype", ["xyz"]],
  ["path", ["sep", "xyz", "delimiter"]],
  ["path.posix", ["sep", "xyz"]],
  ["fs", ["xyz", "constants2"]],
  ["fs.constants", ["O_RDONLY", "xyz"]],
  ["Module", ["_cache2", "wrapper2", "xyz", "globalPaths2", "_nodeModulePaths2"]],
  ["new Module(\"xyzid\")", ["id", "exports", "loaded", "xyz", "filename", "paths", "children", "parent"]],
  ["Bun.file(\"nowhere.txt\")", ["name", "size", "type", "xyz", "lastModified"]],
  ["new Bun.Glob(\"*.x\")", ["xyz"]],
  ["Bun.hash", ["xyz", "wyhash"]],
  ["new FormData()", ["xyz", "length"]],
  ["new BroadcastChannel(\"xyz\")", ["onmessage", "name", "xyz"]],
  ["new ReadableStream()", ["locked", "xyz"]],
  ["new WritableStream()", ["locked", "xyz"]],
  ["new TransformStream()", ["readable", "xyz"]],
  ["new CustomEvent(\"x\", { detail: 1 })", ["detail", "xyz"]],
  ["new DOMException(\"m\", \"AbortError\")", ["name", "message", "code", "xyz", "stack"]],
  ["crypto.webcrypto", ["subtle", "xyz"]],
  ["new util.TextDecoder()", ["encoding", "xyz"]],
];

const sites = "function get%d(o) { return o%s; } function has%d(o) { return %s in o; } function call%d(o) { return o%s(); }";
const looks = "{ const head = \"%s\"; let o; try { o = (%s); } catch (e) { o = null; } if (o) { const n = %s, keep = saved(o, n); const look = i => { let s; try { s = show(get%d(o)) + \" \" + has%d(o); } catch (e) { s = \"THROWS \" + e.name; } let c; try { c = typeof get%d(o) === \"function\" && !/^(class|exit|abort|kill|reallyExit|next|then|write|end|destroy|close)/.test(n) && /^(toString|valueOf|hasOwnProperty|getTime|m|has|get)$/.test(n) ? show(call%d(o)) : \"-\"; } catch (e) { c = \"THROWS \" + e.name; } say(head + \" | \" + i + \": \" + s + \" \" + c); };";
const steps = "  look(0); look(1); look(2); let ok = true; try { alter[%d](o, n); } catch (e) { ok = false; say(head + \" | REFUSED \" + e.name); } if (ok) { look(3); look(4); } restore(o, n, keep); look(5); } }";

const filled = (template: string, ...values: (string | number)[]) => template.replace(/%[ds]/g, () => String(values.shift()));

export function program(seed: number): { file: string; text: string } {
  const random = new Random(seed);
  const lines = [`// generated by host-object-named-reads.ts ${seed}`, ...head];
  const shuffled = [...objects];
  random.shuffle(shuffled);
  let k = 0;
  for (const [maker, names] of shuffled) {
    if (/^(Object\.freeze|Object\.seal|Object\.preventExtensions|setTimeout|setImmediate|new BroadcastChannel|new MessageChannel)/.test(maker)) continue;
    for (const name of [...names, ...random.sample(["toString", "constructor", "hasOwnProperty", "valueOf", "absent1"], 2)]) {
      k++;
      const quoted = `"${name}"`;
      const access = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? "." + name : `[${quoted}]`;
      const alteration = random.randrange(14);
      const group = `${maker.slice(0, 34)} ${name} / ${alteration}`.replaceAll("\\", "").replaceAll('"', "'");
      lines.push(filled(sites, k, access, k, quoted, k, access));
      lines.push(filled(looks, group, maker, quoted, k, k, k, k));
      lines.push(filled(steps, alteration));
    }
  }
  lines.push("for (const line of lines) console.log(line); process.exit(0);");
  return { file: "main.cjs", text: lines.join("\n") + "\n" };
}
