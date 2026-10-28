// The namespace objects of library modules reach a parameter that also takes a value that the compiler cannot follow; their members are read there under keys that it cannot follow, and called. ../../flow-schedules.test.ts builds it under four schedules.
import * as path from "node:path";
import * as os from "node:os";
import * as util from "node:util";
import * as zlib from "node:zlib";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const hide = value => new CustomEvent("x", { detail: value }).detail;
function member(object, key) {
  hide(object);
  return object[key];
}
member(hide({ a: 1 }), hide("a"));
const p0 = { get: () => path };
const p = () => p0.get();
const o0 = { get: () => os };
const o = () => o0.get();
const u0 = { get: () => util };
const u = () => u0.get();
const z0 = { get: () => zlib };
const z = () => z0.get();
const q0 = { get: () => require("node:querystring") };
const q = () => q0.get();
const r0 = { get: () => require("node:url") };
const r = () => r0.get();
const attempt = (label, run) => { try { console.log(label, run()); } catch (error) { console.log(label, "THROWS", String(error.message).slice(0, 60)); } };
attempt("join", () => member(p(), hide("join"))("a", "b"));
attempt("basename", () => member(p(), hide("basename"))("/x/y.js"));
attempt("cpus", () => typeof member(o(), hide("cpus"))().length);
attempt("totalmem", () => typeof member(o(), hide("totalmem"))());
attempt("format", () => member(u(), hide("format"))("%s-%d", "a", 1));
attempt("isDeepStrictEqual", () => member(u(), hide("isDeepStrictEqual"))({ a: 1 }, { a: 1 }));
attempt("inspect", () => member(u(), hide("inspect"))({ a: [1] }));
attempt("gzip", () => member(z(), hide("gunzipSync"))(member(z(), hide("gzipSync"))("hello")).toString());
attempt("deflate", () => member(z(), hide("inflateSync"))(member(z(), hide("deflateSync"))("hello")).toString());
attempt("crc32", () => member(z(), hide("crc32"))("hello"));
attempt("stringify", () => member(q(), hide("stringify"))({ a: 1, b: "x y" }));
attempt("fileURLToPath", () => member(r(), hide("fileURLToPath"))("file:///a/b"));
attempt("pathToFileURL", () => member(r(), hide("pathToFileURL"))("/a/b").href);
