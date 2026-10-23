import { DeclaredTypesForTesting } from "bun:internal-for-testing";
const instance = new DeclaredTypesForTesting();
const show = value => typeof value === "function" ? "function" : typeof value === "symbol" ? value.toString() : typeof value === "bigint" ? value + "n" : typeof value === "object" && value !== null ? Object.prototype.toString.call(value) : String(value);
const attempt = f => { try { return show(f()); } catch (error) { return "throws " + error.name; } };
const values = [undefined, null, true, 0, 1.5, -0, 2 ** 40, "text", "", Symbol("s"), 12n, {}, [1, 2], () => 1, new Map(), new Headers({ a: "b" }), new Uint8Array(2), Buffer.from("ab"), new Date(0), Promise.resolve(1), new Error("e"), new URL("http://a/b"), new Blob(["x"]), new ArrayBuffer(3), instance];
function asString(v) { const s = instance.string(v); return s.length + ":" + s.slice(0, 2) + ":" + (s + "!") + ":" + typeof s; }
function asNumber(v) { const n = instance.number(v); return n + 1 + ":" + n * 2 + ":" + (n | 0) + ":" + typeof n; }
function asInt32(v) { const n = instance.int32(v); return (n + 1) + ":" + (n >> 1) + ":" + [10, 20, 30][n]; }
function asBoolean(v) { const b = instance.boolean(v); return (b ? "yes" : "no") + ":" + (b === true) + ":" + !b; }
function asBigInt(v) { const n = instance.bigint(v); return n + 1n; }
function asUndefined(v) { const u = instance.undefined(v); return u === undefined ? "nothing" : show(u); }
function asNull(v) { const u = instance.null(v); return u === null ? "null" : show(u); }
function asObject(v) { const o = instance.object(v); return Object.keys(o).length + ":" + ("a" in o); }
function asArray(v) { const a = instance.array(v); return a.length + ":" + a[0] + ":" + a.map(x => x + 1).join(); }
function asHeaders(v) { const h = instance.headers(v); return h.get("a") + ":" + h.has("a"); }
function asBytes(v) { const b = instance.uint8Array(v); return b.length + ":" + b[0] + ":" + b.byteLength + ":" + b.subarray(1).length; }
function asBuffer(v) { const b = instance.buffer(v); return b.toString("hex") + ":" + b.length + ":" + b.readUInt8(0); }
function asDate(v) { return instance.date(v).getTime(); }
function asError(v) { return instance.error(v).message; }
function asURL(v) { const u = instance.url(v); return u.pathname + ":" + u.href; }
function asBlob(v) { const b = instance.blob(v); return b.size + ":" + b.type; }
function asArrayBuffer(v) { return instance.arrayBuffer(v).byteLength; }
function asReceiver(v) { return instance.receiver(v) === instance; }
function asSameClass(v) { return show(instance.sameClass(v).string("x")); }
function asNumberOrUndefined(v) { const n = instance.numberOrUndefined(v); return n === undefined ? "none" : n + 1; }
function asStringOrBufferOrNull(v) { const s = instance.stringOrBufferOrNull(v); return s === null ? "null" : typeof s === "string" ? s.length : s.byteLength; }
function asStatic(v) { return DeclaredTypesForTesting.number(v) + 1; }
function asHeld(v) { instance.hold(v); const s = instance.heldString; return s.length + ":" + typeof s; }
async function asPromise(v) { const p = instance.promise(v); return show(await p) + ":" + (p instanceof Promise) + ":" + typeof p.then; }
const lines = [];
for (const f of [asString, asNumber, asInt32, asBoolean, asBigInt, asUndefined, asNull, asObject, asArray, asHeaders, asBytes, asBuffer, asDate, asError, asURL, asBlob, asArrayBuffer, asReceiver, asSameClass, asNumberOrUndefined, asStringOrBufferOrNull, asStatic, asHeld])
  for (let round = 0; round < 3; round++) for (const [i, v] of values.entries()) { const line = f.name + " " + i + ": " + attempt(() => f(v)); if (round === 2) lines.push(line); }
for (const [i, v] of values.entries()) lines.push("asPromise " + i + ": " + (await asPromise(v).catch(error => "rejects " + error.name)));
console.log(lines.join("\n"));
