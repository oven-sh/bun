// What instrumenting packages do to Node's modules: a function of a module replaced, a method of EventEmitter, Stream or Buffer replaced or added, hooks into the module loader.
import { inBothModes, js, pkg, ts, type Case } from "./run-packages";

const differs =
  "Under --aot the built-in objects of the language cannot be changed: a store that would replace or add a method throws a TypeError, or is a build error where it is certain to run.";

export const cases: Case[] = [
  ...inBothModes("fs-function", "pn_fs_function", {
    "index.js": `var fs = require("fs");
var orig = fs.readFileSync;
var calls = [];
fs.readFileSync = function (p) { calls.push("patched"); return orig.apply(this, arguments); };
var text = require("fs").readFileSync(__filename.indexOf("$bunfs") < 0 && __filename.indexOf("~BUN") < 0 ? __filename : process.execPath).length > 0;
fs.readFileSync = orig;
exports.ok = [calls, text, fs.readFileSync === orig];
`,
    "other.js": `globalThis.__n = (globalThis.__n || 0) + 1;
exports.n = globalThis.__n;
`,
  }),
  ...inBothModes("fs-node-prefix-same-object", "pn_fs_node_prefix_same_object", {
    "index.js": `var a = require("fs"), b = require("node:fs");
a.__mine = 1;
exports.ok = [a === b, b.__mine, delete a.__mine];
`,
    "other.js": `globalThis.__n = (globalThis.__n || 0) + 1;
exports.n = globalThis.__n;
`,
  }),
  ...inBothModes("fs-graceful", "pn_fs_graceful", {
    "index.js": `var fs = require("fs");
var q = Symbol.for("my.queue");
Object.defineProperty(fs, q, { get: function () { return []; } });
var close = fs.close;
fs.close = (function (orig) { function close(fd, cb) { return orig.call(fs, fd, cb); } Object.defineProperty(close, Symbol.for("my.previous"), { value: orig }); return close; })(fs.close);
var r = [Array.isArray(fs[q]), fs.close.name, fs.close !== close];
fs.close = close;
exports.ok = r;
`,
    "other.js": `globalThis.__n = (globalThis.__n || 0) + 1;
exports.n = globalThis.__n;
`,
  }),
  ...inBothModes("process-emit", "pn_process_emit", {
    "index.js": `var orig = process.emit; var seen = [];
process.emit = function (ev) { seen.push(ev); return orig.apply(this, arguments); };
process.emit("my-event", 1);
process.emit = orig;
var re = process.reallyExit; process.reallyExit = function (c) { return re.call(process, c); }; var same = process.reallyExit !== re; process.reallyExit = re;
exports.ok = [seen, same];
`,
    "other.js": `globalThis.__n = (globalThis.__n || 0) + 1;
exports.n = globalThis.__n;
`,
  }),
  ...inBothModes("process-cwd", "pn_process_cwd", {
    "index.js": `var cwd = process.cwd; var cached = null;
process.cwd = function () { if (!cached) cached = cwd.call(process); return cached; };
var a = process.cwd() === process.cwd();
process.cwd = cwd;
exports.ok = [a, typeof cached];
`,
    "other.js": `globalThis.__n = (globalThis.__n || 0) + 1;
exports.n = globalThis.__n;
`,
  }),
  ...inBothModes("emitter-prototype", "pn_emitter_prototype", {
    "index.js": `var EE = require("events");
var orig = EE.prototype.emit; var seen = [];
EE.prototype.emit = function (ev) { seen.push(String(ev)); return orig.apply(this, arguments); };
var e = new EE(); var got = [];
e.on("x", function (v) { got.push(v); }); e.emit("x", 1);
class Sub extends EE {} var s = new Sub(); s.on("y", function () { got.push("y"); }); s.emit("y");
EE.prototype.emit = orig;
e.emit("x", 2);
exports.ok = [seen, got];
`,
    "other.js": `globalThis.__n = (globalThis.__n || 0) + 1;
exports.n = globalThis.__n;
`,
  }),
  ...inBothModes("emitter-prototype-added", "pn_emitter_prototype_added", {
    "index.js": `var EE = require("events");
EE.prototype.onceAll = function () { return "added"; };
var r = [new EE().onceAll(), typeof require("stream").Readable.prototype.onceAll];
delete EE.prototype.onceAll;
exports.ok = r.concat(typeof EE.prototype.onceAll);
`,
    "other.js": `globalThis.__n = (globalThis.__n || 0) + 1;
exports.n = globalThis.__n;
`,
  }),
  ...inBothModes("emitter-static", "pn_emitter_static", {
    "index.js": `var EE = require("events");
var was = EE.defaultMaxListeners;
EE.defaultMaxListeners = 50;
var r = [EE.defaultMaxListeners, new EE().getMaxListeners()];
EE.defaultMaxListeners = was;
exports.ok = r;
`,
    "other.js": `globalThis.__n = (globalThis.__n || 0) + 1;
exports.n = globalThis.__n;
`,
  }),
  ...inBothModes("buffer-prototype", "pn_buffer_prototype", {
    "index.js": `var r = [];
Buffer.prototype.equalConstant = function (o) { return this.length === o.length; };
r.push(Buffer.from("ab").equalConstant(Buffer.from("cd")));
var orig = Buffer.prototype.toString;
Buffer.prototype.toString = function () { return "patched:" + orig.apply(this, arguments); };
r.push(Buffer.from("ab").toString());
Buffer.prototype.toString = orig;
r.push(Buffer.from("ab").toString());
delete Buffer.prototype.equalConstant;
exports.ok = r;
`,
    "other.js": `globalThis.__n = (globalThis.__n || 0) + 1;
exports.n = globalThis.__n;
`,
  }, { differs }),
  ...inBothModes("buffer-static", "pn_buffer_static", {
    "index.js": `var orig = Buffer.from; var n = 0;
Buffer.from = function () { n++; return orig.apply(Buffer, arguments); };
var b = Buffer.from("x");
Buffer.from = orig;
exports.ok = [n, b.length];
`,
    "other.js": `globalThis.__n = (globalThis.__n || 0) + 1;
exports.n = globalThis.__n;
`,
  }, { differs }),
  ...inBothModes("stream-prototype", "pn_stream_prototype", {
    "index.js": `var S = require("stream");
var orig = S.Readable.prototype.pipe; var n = 0;
S.Readable.prototype.pipe = function () { n++; return orig.apply(this, arguments); };
var r = new S.PassThrough(); r.pipe(new S.PassThrough());
S.Readable.prototype.pipe = orig;
exports.ok = [n];
`,
    "other.js": `globalThis.__n = (globalThis.__n || 0) + 1;
exports.n = globalThis.__n;
`,
  }),
  ...inBothModes("http-request", "pn_http_request", {
    "index.js": `var http = require("http");
var orig = http.request; var seen = [];
http.request = function (o) { seen.push(typeof o); return { on: function () { return this; }, end: function () {} }; };
require("node:http").request({ host: "localhost" }).end();
var getUses = http.get !== undefined;
http.request = orig;
exports.ok = [seen, getUses];
`,
    "other.js": `globalThis.__n = (globalThis.__n || 0) + 1;
exports.n = globalThis.__n;
`,
  }),
  ...inBothModes("child-process-spawn", "pn_child_process_spawn", {
    "index.js": `var cp = require("child_process");
var orig = cp.spawnSync; var seen = [];
cp.spawnSync = function (c) { seen.push(c); return { status: 0 }; };
var r = require("child_process").spawnSync("nothing-real");
cp.spawnSync = orig;
exports.ok = [seen, r.status];
`,
    "other.js": `globalThis.__n = (globalThis.__n || 0) + 1;
exports.n = globalThis.__n;
`,
  }),
  ...inBothModes("util-inspect-custom", "pn_util_inspect_custom", {
    "index.js": `var util = require("util");
class K { [util.inspect.custom]() { return "custom K"; } }
var was = util.inspect.defaultOptions.depth;
util.inspect.defaultOptions.depth = 0;
var deep = util.inspect({ a: { b: { c: 1 } } });
util.inspect.defaultOptions.depth = was;
exports.ok = [util.inspect(new K()), deep, util.format("%s %d %j", "s", 1, { a: 1 })];
`,
    "other.js": `globalThis.__n = (globalThis.__n || 0) + 1;
exports.n = globalThis.__n;
`,
  }),
  ...inBothModes("util-promisify-custom", "pn_util_promisify_custom", {
    "index.js": `var util = require("util");
function f(cb) { cb(null, "cb"); }
f[util.promisify.custom] = function () { return Promise.resolve("custom"); };
exports.ok = [util.promisify(f) === f[util.promisify.custom], typeof util.promisify(setTimeout)];
`,
    "other.js": `globalThis.__n = (globalThis.__n || 0) + 1;
exports.n = globalThis.__n;
`,
  }),
  ...inBothModes("module-load-hook", "pn_module_load_hook", {
    "index.js": `var Module = require("module");
var r = [typeof Module._load, typeof Module._resolveFilename, typeof Module.prototype.require, typeof Module._extensions, typeof Module._cache, typeof Module.builtinModules, typeof Module.createRequire, typeof Module.wrap];
var orig = Module._load; var seen = [];
try { Module._load = function (request) { seen.push(request); return orig.apply(this, arguments); }; var name = "node:" + "os"; require(name); Module._load = orig; } catch (e) { seen.push(e.name); }
exports.ok = [r, seen];
`,
    "other.js": `globalThis.__n = (globalThis.__n || 0) + 1;
exports.n = globalThis.__n;
`,
  }, { differs: "A name that is made at run time brings nothing into the executable: `require(name)` of a built-in module that no file names throws." }),
  ...inBothModes("module-extensions", "pn_module_extensions", {
    "index.js": `var r = [];
try { require.extensions[".mine"] = function (m, f) { m.exports = "loaded by my extension"; }; r.push(typeof require.extensions[".mine"]); delete require.extensions[".mine"]; } catch (e) { r.push(e.name); }
exports.ok = r;
`,
    "other.js": `globalThis.__n = (globalThis.__n || 0) + 1;
exports.n = globalThis.__n;
`,
  }),
  ...inBothModes("require-cache", "pn_require_cache", {
    "index.js": `var r = [];
var key = require.resolve("./other.js");
var first = require("./other.js");
r.push(typeof require.cache[key], first.n);
delete require.cache[key];
var second = require("./other.js");
r.push(second === first, second.n);
try { require.cache[key].exports = { n: "replaced in the cache" }; } catch (e) { r.push(e.name); }
r.push(require("./other.js").n);
exports.ok = r;
`,
    "other.js": `globalThis.__n = (globalThis.__n || 0) + 1;
exports.n = globalThis.__n;
`,
  }),
  ...inBothModes("timers-module", "pn_timers_module", {
    "index.js": `var timers = require("timers");
var orig = timers.setTimeout; var n = 0;
timers.setTimeout = function () { n++; return orig.apply(this, arguments); };
clearTimeout(timers.setTimeout(function () {}, 1));
clearTimeout(setTimeout(function () {}, 1));
timers.setTimeout = orig;
exports.ok = [n, timers.setTimeout === setTimeout];
`,
    "other.js": `globalThis.__n = (globalThis.__n || 0) + 1;
exports.n = globalThis.__n;
`,
  }),
  ...inBothModes("console-methods", "pn_console_methods", {
    "index.js": `var c = require("console");
var seen = []; var orig = console.error;
console.error = function () { seen.push([].join.call(arguments, " ")); };
c.error("through the module"); console.error("through the global");
console.error = orig;
exports.ok = [seen, c === console];
`,
    "other.js": `globalThis.__n = (globalThis.__n || 0) + 1;
exports.n = globalThis.__n;
`,
  }),
  ...inBothModes("crypto-random", "pn_crypto_random", {
    "index.js": `var crypto = require("crypto");
var orig = crypto.randomBytes;
crypto.randomBytes = function (n) { return Buffer.alloc(n, 7); };
var r = require("node:crypto").randomBytes(2).toString("hex");
crypto.randomBytes = orig;
var g = globalThis.crypto.getRandomValues; var rr; try { globalThis.crypto.getRandomValues = function (a) { return a.fill(1); }; rr = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(2))); globalThis.crypto.getRandomValues = g; } catch (e) { rr = e.name; }
exports.ok = [r, rr];
`,
    "other.js": `globalThis.__n = (globalThis.__n || 0) + 1;
exports.n = globalThis.__n;
`,
  }),
  ...inBothModes("path-and-os", "pn_path_and_os", {
    "index.js": `var path = require("path"), os = require("os");
var oj = path.join; path.join = function () { return "patched join"; }; var a = require("node:path").join("a", "b"); path.join = oj;
var oh = os.homedir; os.homedir = function () { return "/mock/home"; }; var b = require("os").homedir(); os.homedir = oh;
exports.ok = [a, b, path.posix.join("a", "b"), path.join("a", "b")];
`,
    "other.js": `globalThis.__n = (globalThis.__n || 0) + 1;
exports.n = globalThis.__n;
`,
  }),
  ...inBothModes("url-global-classes", "pn_url_global_classes", {
    "index.js": `var r = [];
try { var o = URL.prototype.toString; URL.prototype.toString = function () { return "patched"; }; r.push(String(new URL("http://a/"))); URL.prototype.toString = o; } catch (e) { r.push(e.name); }
try { var h = Headers.prototype.get; Headers.prototype.get = function () { return "patched"; }; r.push(new Headers({ a: "1" }).get("a")); Headers.prototype.get = h; } catch (e) { r.push(e.name); }
try { Response.prototype.mine = function () { return "mine"; }; r.push(new Response("x").mine()); delete Response.prototype.mine; } catch (e) { r.push(e.name); }
try { var f = globalThis.fetch; globalThis.fetch = function () { return "mock"; }; r.push(fetch("x")); globalThis.fetch = f; } catch (e) { r.push(e.name); }
try { AbortController.prototype.abortLater = function () { return 1; }; r.push(new AbortController().abortLater()); } catch (e) { r.push(e.name); }
exports.ok = r;
`,
    "other.js": `globalThis.__n = (globalThis.__n || 0) + 1;
exports.n = globalThis.__n;
`,
  }, { differs: "Under --aot the prototypes of Request, Response, Blob, URL, URLSearchParams and Headers are locked: a store that would replace or add a method throws a TypeError." }),
  ...inBothModes("bun-object", "pn_bun_object", {
    "index.js": `var r = [];
try { var o = Bun.file; Bun.file = function () { return "patched"; }; r.push(Bun.file("x")); Bun.file = o; } catch (e) { r.push(e.name); }
try { Bun.mine = 1; r.push(Bun.mine); } catch (e) { r.push(e.name); }
try { var e0 = Bun.env.MINE; Bun.env.MINE = "1"; r.push(process.env.MINE); } catch (e) { r.push(e.name); }
exports.ok = r;
`,
    "other.js": `globalThis.__n = (globalThis.__n || 0) + 1;
exports.n = globalThis.__n;
`,
  }),
  {
    name: "seen-by-the-program",
    differs,
    files: {
      ...pkg("patcher", {
        "index.js": `"use strict";
const fs = require("fs"), EE = require("events"), path = require("path");
const orig = { exists: fs.existsSync, emit: EE.prototype.emit, base: path.basename };
exports.on = () => { fs.existsSync = () => "patched existsSync"; EE.prototype.emit = function () { return "patched emit"; }; path.basename = () => "patched basename"; try { require("module").syncBuiltinESMExports(); } catch {} };
exports.off = () => { fs.existsSync = orig.exists; EE.prototype.emit = orig.emit; path.basename = orig.base; try { require("module").syncBuiltinESMExports(); } catch {} };
`,
      }, {"main": "index.js"}),
    },
    importers: {
      "names.mjs": `import { existsSync } from "node:fs";
import { basename } from "node:path";
import { EventEmitter } from "node:events";
import p from "patcher";
${js}t("before", () => [existsSync("/nothing"), basename("/a/b"), new EventEmitter().emit("x")]);
p.on();
t("patched", () => [existsSync("/nothing"), basename("/a/b"), new EventEmitter().emit("x")]);
p.off();
t("after", () => [existsSync("/nothing"), basename("/a/b"), new EventEmitter().emit("x")]);
`,
      "default.mjs": `import fs from "node:fs";
import path from "node:path";
import EventEmitter from "node:events";
import p from "patcher";
${js}p.on();
t("patched", () => [fs.existsSync("/nothing"), path.basename("/a/b"), new EventEmitter().emit("x")]);
p.off();
t("after", () => [fs.existsSync("/nothing"), path.basename("/a/b"), new EventEmitter().emit("x")]);
`,
      "namespace.mjs": `import * as fs from "node:fs";
import * as path from "node:path";
import p from "patcher";
${js}p.on();
t("patched", () => [fs.existsSync("/nothing"), path.basename("/a/b"), fs.default.existsSync("/nothing")]);
p.off();
t("after", () => [fs.existsSync("/nothing"), path.basename("/a/b")]);
`,
      "require.cjs": `${js}const fs = require("fs"), path = require("path"), EE = require("events"), p = require("patcher");
const { existsSync } = fs;
p.on();
t("patched", () => [fs.existsSync("/nothing"), existsSync("/nothing"), path.basename("/a/b"), new EE().emit("x")]);
p.off();
t("after", () => [fs.existsSync("/nothing"), path.basename("/a/b"), new EE().emit("x")]);
`,
      "typed.ts": `import { existsSync } from "node:fs";
import * as path from "node:path";
import { EventEmitter } from "node:events";
${ts}const p = require("patcher");
class Mine extends EventEmitter { hello(): boolean { return this.emit("hello"); } }
t("before", () => [existsSync("/nothing"), path.basename("/a/b"), new Mine().hello()]);
p.on();
t("patched", () => [existsSync("/nothing"), path.basename("/a/b"), new Mine().hello(), new EventEmitter().emit("x")]);
p.off();
t("after", () => [existsSync("/nothing"), path.basename("/a/b"), new Mine().hello()]);
`,
    },
  },
];
