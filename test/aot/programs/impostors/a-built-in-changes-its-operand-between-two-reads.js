"use strict";

const log = [];

function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (value instanceof Error) return value.constructor.name;
  const parent = Object.getPrototypeOf(value);
  const kind = parent === Object.prototype || parent === Array.prototype ? "" : parent === null ? "bare " : parent.constructor.name + " ";
  const isList = Array.isArray(value);
  const parts = [];
  if (isList) for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
  for (const key of Reflect.ownKeys(value)) {
    if (isList && typeof key === "string" && (key === "length" || /^\d+$/.test(key))) continue;
    parts.push(String(key) + ": " + show(value[key]));
  }
  return kind + (isList ? "[" : "{") + parts.join(", ") + (isList ? "]" : "}");
}

function outcome(run) {
  log.length = 0;
  try {
    const value = run();
    const effects = log.join(", ");
    return show(value) + (effects ? " | " + effects : "");
  } catch (error) {
    const effects = log.join(", ");
    return "threw " + show(error) + (effects ? " | " + effects : "");
  }
}

function attempt(label, run) {
  console.log(label + " -> " + outcome(run));
}

function o1(o) {
  const before = [o.y, Object.keys(o).join()];
  void (o.y = "changed");
  return [before, [o.y, Object.keys(o).join()]];
}

function o2(o) {
  const before = [o.y, Object.keys(o).join()];
  void (o["y"] = "changed");
  return [before, [o.y, Object.keys(o).join()]];
}

function o3(o) {
  const before = [o.y, Object.keys(o).join()];
  void (Object.assign(o, { y: "changed" }));
  return [before, [o.y, Object.keys(o).join()]];
}

function o4(o) {
  const before = [o.y, Object.keys(o).join()];
  void (Reflect.set(o, "y", "changed"));
  return [before, [o.y, Object.keys(o).join()]];
}

function o5(o) {
  const before = [o.y, Object.keys(o).join()];
  void (Reflect.set({}, "y", "changed", o));
  return [before, [o.y, Object.keys(o).join()]];
}

function o6(o) {
  const before = [o.y, Object.keys(o).join()];
  void (Object.defineProperty(o, "y", { value: "changed" }));
  return [before, [o.y, Object.keys(o).join()]];
}

function o7(o) {
  const before = [o.y, Object.keys(o).join()];
  void (Object.defineProperty(o, "y", { get: () => "got" }));
  return [before, [o.y, Object.keys(o).join()]];
}

function o8(o) {
  const before = [o.y, Object.keys(o).join()];
  void (Object.defineProperties(o, { y: { value: "changed" } }));
  return [before, [o.y, Object.keys(o).join()]];
}

function o9(o) {
  const before = [o.y, Object.keys(o).join()];
  void (Reflect.defineProperty(o, "y", { value: "changed" }));
  return [before, [o.y, Object.keys(o).join()]];
}

function o10(o) {
  const before = [o.y, Object.keys(o).join()];
  void (delete o.y);
  return [before, [o.y, Object.keys(o).join()]];
}

function o11(o) {
  const before = [o.y, Object.keys(o).join()];
  void (Reflect.deleteProperty(o, "y"));
  return [before, [o.y, Object.keys(o).join()]];
}

function o12(o) {
  const before = [o.y, Object.keys(o).join()];
  void (Object.setPrototypeOf(o, { y: "inherited" }), delete o.y);
  return [before, [o.y, Object.keys(o).join()]];
}

function o13(o) {
  const before = [o.y, Object.keys(o).join()];
  void (Array.prototype.push.call(o, "pushed"));
  return [before, [o.y, Object.keys(o).join()]];
}

function o14(o) {
  const before = [o.y, Object.keys(o).join()];
  void (Array.prototype.fill.call(Object.assign(o, { length: 1 }), "filled"));
  return [before, [o.y, Object.keys(o).join()]];
}

function o15(o) {
  const before = [o.y, Object.keys(o).join()];
  void (Object.entries(o).forEach(([key]) => { o[key] = "changed"; }));
  return [before, [o.y, Object.keys(o).join()]];
}

function o16(o) {
  const before = [o.y, Object.keys(o).join()];
  void (JSON.parse("1", () => { o.y = "changed"; }));
  return [before, [o.y, Object.keys(o).join()]];
}

function o17(o) {
  const before = [o.y, Object.keys(o).join()];
  void (JSON.stringify({ toJSON() { o.y = "changed"; } }));
  return [before, [o.y, Object.keys(o).join()]];
}

function o18(o) {
  const before = [o.y, Object.keys(o).join()];
  void ([0].forEach(function () { this.y = "changed"; }, o));
  return [before, [o.y, Object.keys(o).join()]];
}

function o19(o) {
  const before = [o.y, Object.keys(o).join()];
  void ((function () { this.y = "changed"; }).call(o));
  return [before, [o.y, Object.keys(o).join()]];
}

function o20(o) {
  const before = [o.y, Object.keys(o).join()];
  void (Reflect.apply(function () { this.y = "changed"; }, o, []));
  return [before, [o.y, Object.keys(o).join()]];
}

function o21(o) {
  const before = [o.y, Object.keys(o).join()];
  void (Object.getOwnPropertyDescriptor({ set k(value) { o.y = value; } }, "k").set("changed"));
  return [before, [o.y, Object.keys(o).join()]];
}

function o22(o) {
  const before = [o.y, Object.keys(o).join()];
  void (Object.freeze(o), Reflect.set(o, "y", "changed"));
  return [before, [o.y, Object.keys(o).join()]];
}

function o23(o) {
  const before = [o.y, Object.keys(o).join()];
  void (new Proxy(o, {}).y = "changed");
  return [before, [o.y, Object.keys(o).join()]];
}

function o24(o) {
  const before = [o.y, Object.keys(o).join()];
  void (Object.create(o).y = "own of the heir");
  return [before, [o.y, Object.keys(o).join()]];
}

function o25(o) {
  const before = [o.y, Object.keys(o).join()];
  void (Object.create(new Proxy(o, {})).y = "through the proxy");
  return [before, [o.y, Object.keys(o).join()]];
}

function o26(o) {
  const before = [o.y, Object.keys(o).join()];
  void (structuredClone(o).y = "of the clone");
  return [before, [o.y, Object.keys(o).join()]];
}

function o27(o) {
  const before = [o.y, Object.keys(o).join()];
  void (({ ...o }).y = "of the copy");
  return [before, [o.y, Object.keys(o).join()]];
}

function a1(a) {
  const before = [a[0], a.length];
  void (a[0] = "changed");
  return [before, [a[0], a.length]];
}

function a2(a) {
  const before = [a[0], a.length];
  void (a.reverse());
  return [before, [a[0], a.length]];
}

function a3(a) {
  const before = [a[0], a.length];
  void (a.sort());
  return [before, [a[0], a.length]];
}

function a4(a) {
  const before = [a[0], a.length];
  void (a.fill("changed"));
  return [before, [a[0], a.length]];
}

function a5(a) {
  const before = [a[0], a.length];
  void (a.copyWithin(0, 1));
  return [before, [a[0], a.length]];
}

function a6(a) {
  const before = [a[0], a.length];
  void (a.splice(0, 1, "changed"));
  return [before, [a[0], a.length]];
}

function a7(a) {
  const before = [a[0], a.length];
  void (a.splice(0));
  return [before, [a[0], a.length]];
}

function a8(a) {
  const before = [a[0], a.length];
  void (a.shift());
  return [before, [a[0], a.length]];
}

function a9(a) {
  const before = [a[0], a.length];
  void (a.unshift("changed"));
  return [before, [a[0], a.length]];
}

function a10(a) {
  const before = [a[0], a.length];
  void (a.pop());
  return [before, [a[0], a.length]];
}

function a11(a) {
  const before = [a[0], a.length];
  void (a.push("pushed"));
  return [before, [a[0], a.length]];
}

function a12(a) {
  const before = [a[0], a.length];
  void (a.length = 0);
  return [before, [a[0], a.length]];
}

function a13(a) {
  const before = [a[0], a.length];
  void (a.length = 5);
  return [before, [a[0], a.length]];
}

function a14(a) {
  const before = [a[0], a.length];
  void (Array.prototype.reverse.call(a));
  return [before, [a[0], a.length]];
}

function a15(a) {
  const before = [a[0], a.length];
  void (Reflect.apply(Array.prototype.fill, a, ["changed"]));
  return [before, [a[0], a.length]];
}

function a16(a) {
  const before = [a[0], a.length];
  void ([].push.apply(a, ["pushed", "twice"]));
  return [before, [a[0], a.length]];
}

function a17(a) {
  const before = [a[0], a.length];
  void (Reflect.set(a, 0, "changed"));
  return [before, [a[0], a.length]];
}

function a18(a) {
  const before = [a[0], a.length];
  void (Reflect.set(a, "0", "changed"));
  return [before, [a[0], a.length]];
}

function a19(a) {
  const before = [a[0], a.length];
  void (Reflect.set(a, "length", 0));
  return [before, [a[0], a.length]];
}

function a20(a) {
  const before = [a[0], a.length];
  void (Object.assign(a, ["changed"]));
  return [before, [a[0], a.length]];
}

function a21(a) {
  const before = [a[0], a.length];
  void (Object.assign(a, { length: 0 }));
  return [before, [a[0], a.length]];
}

function a22(a) {
  const before = [a[0], a.length];
  void (Object.defineProperty(a, 0, { value: "changed" }));
  return [before, [a[0], a.length]];
}

function a23(a) {
  const before = [a[0], a.length];
  void (Object.defineProperty(a, 0, { get: () => "got" }));
  return [before, [a[0], a.length]];
}

function a24(a) {
  const before = [a[0], a.length];
  void (Object.defineProperty(a, "length", { value: 0 }));
  return [before, [a[0], a.length]];
}

function a25(a) {
  const before = [a[0], a.length];
  void (delete a[0]);
  return [before, [a[0], a.length]];
}

function a26(a) {
  const before = [a[0], a.length];
  void (Reflect.deleteProperty(a, 0));
  return [before, [a[0], a.length]];
}

function a27(a) {
  const before = [a[0], a.length];
  void (new Proxy(a, {})[0] = "changed");
  return [before, [a[0], a.length]];
}

function a28(a) {
  const before = [a[0], a.length];
  void (new Proxy(a, {}).length = 0);
  return [before, [a[0], a.length]];
}

function a29(a) {
  const before = [a[0], a.length];
  void (a.forEach((x, i, list) => { list[i] = "changed"; }));
  return [before, [a[0], a.length]];
}

function a30(a) {
  const before = [a[0], a.length];
  void (a.map((x, i, list) => list.pop()));
  return [before, [a[0], a.length]];
}

function a31(a) {
  const before = [a[0], a.length];
  void (a.sort(() => { a[0] = "changed in the comparator"; return 0; }));
  return [before, [a[0], a.length]];
}

function a32(a) {
  const before = [a[0], a.length];
  void (a.toSorted());
  return [before, [a[0], a.length]];
}

function a33(a) {
  const before = [a[0], a.length];
  void (a.with(0, "of the copy"));
  return [before, [a[0], a.length]];
}

function a34(a) {
  const before = [a[0], a.length];
  void (a.slice().reverse());
  return [before, [a[0], a.length]];
}

function a35(a) {
  const before = [a[0], a.length];
  void (a.concat().fill("of the copy"));
  return [before, [a[0], a.length]];
}

function a36(a) {
  const before = [a[0], a.length];
  void (Object.freeze(a), Reflect.set(a, 0, "changed"));
  return [before, [a[0], a.length]];
}

function u1(u) {
  const before = [u[0], u.length, u.byteLength];
  void (u[0] = 9);
  return [before, [u[0], u.length, u.byteLength]];
}

function u2(u) {
  const before = [u[0], u.length, u.byteLength];
  void (u.set([9]));
  return [before, [u[0], u.length, u.byteLength]];
}

function u3(u) {
  const before = [u[0], u.length, u.byteLength];
  void (u.fill(9));
  return [before, [u[0], u.length, u.byteLength]];
}

function u4(u) {
  const before = [u[0], u.length, u.byteLength];
  void (u.reverse());
  return [before, [u[0], u.length, u.byteLength]];
}

function u5(u) {
  const before = [u[0], u.length, u.byteLength];
  void (u.sort((x, y) => y - x));
  return [before, [u[0], u.length, u.byteLength]];
}

function u6(u) {
  const before = [u[0], u.length, u.byteLength];
  void (u.copyWithin(0, 1));
  return [before, [u[0], u.length, u.byteLength]];
}

function u7(u) {
  const before = [u[0], u.length, u.byteLength];
  void (new Uint8Array(u.buffer)[0] = 9);
  return [before, [u[0], u.length, u.byteLength]];
}

function u8(u) {
  const before = [u[0], u.length, u.byteLength];
  void (new Uint16Array(u.buffer)[0] = 0x0909);
  return [before, [u[0], u.length, u.byteLength]];
}

function u9(u) {
  const before = [u[0], u.length, u.byteLength];
  void (new DataView(u.buffer).setUint8(0, 9));
  return [before, [u[0], u.length, u.byteLength]];
}

function u10(u) {
  const before = [u[0], u.length, u.byteLength];
  void (Atomics.store(u, 0, 9));
  return [before, [u[0], u.length, u.byteLength]];
}

function u11(u) {
  const before = [u[0], u.length, u.byteLength];
  void (Atomics.add(u, 0, 8));
  return [before, [u[0], u.length, u.byteLength]];
}

function u12(u) {
  const before = [u[0], u.length, u.byteLength];
  void (new TextEncoder().encodeInto("z", u));
  return [before, [u[0], u.length, u.byteLength]];
}

function u13(u) {
  const before = [u[0], u.length, u.byteLength];
  void (Buffer.from(u.buffer).write("z"));
  return [before, [u[0], u.length, u.byteLength]];
}

function u14(u) {
  const before = [u[0], u.length, u.byteLength];
  void (Buffer.from(u.buffer).fill(9));
  return [before, [u[0], u.length, u.byteLength]];
}

function u15(u) {
  const before = [u[0], u.length, u.byteLength];
  void (u.subarray(0, 1).fill(9));
  return [before, [u[0], u.length, u.byteLength]];
}

function u16(u) {
  const before = [u[0], u.length, u.byteLength];
  void (u.slice(0, 1).fill(9));
  return [before, [u[0], u.length, u.byteLength]];
}

function u17(u) {
  const before = [u[0], u.length, u.byteLength];
  void (Reflect.set(u, 0, 9));
  return [before, [u[0], u.length, u.byteLength]];
}

function u18(u) {
  const before = [u[0], u.length, u.byteLength];
  void (Object.assign(u, [9]));
  return [before, [u[0], u.length, u.byteLength]];
}

function u19(u) {
  const before = [u[0], u.length, u.byteLength];
  void (Object.defineProperty(u, 0, { value: 9 }));
  return [before, [u[0], u.length, u.byteLength]];
}

function u20(u) {
  const before = [u[0], u.length, u.byteLength];
  void (structuredClone(u.buffer, { transfer: [u.buffer] }));
  return [before, [u[0], u.length, u.byteLength]];
}

function u21(u) {
  const before = [u[0], u.length, u.byteLength];
  void (u.buffer.transfer());
  return [before, [u[0], u.length, u.byteLength]];
}

function u22(u) {
  const before = [u[0], u.length, u.byteLength];
  void (u.buffer.transfer(1));
  return [before, [u[0], u.length, u.byteLength]];
}

function u23(u) {
  const before = [u[0], u.length, u.byteLength];
  void (new MessageChannel().port1.postMessage(null, [u.buffer]));
  return [before, [u[0], u.length, u.byteLength]];
}

function u24(u) {
  const before = [u[0], u.length, u.byteLength];
  void (Uint8Array.prototype.set.call(u, { length: 1, 0: 9 }));
  return [before, [u[0], u.length, u.byteLength]];
}

function r1(r) {
  const before = r.lastIndex;
  void (r.test("aa"));
  return [before, r.lastIndex];
}

function r2(r) {
  const before = r.lastIndex;
  void (r.exec("aa"));
  return [before, r.lastIndex];
}

function r3(r) {
  const before = r.lastIndex;
  void ("aa".match(r));
  return [before, r.lastIndex];
}

function r4(r) {
  const before = r.lastIndex;
  void ("aa".replace(r, "b"));
  return [before, r.lastIndex];
}

function r5(r) {
  const before = r.lastIndex;
  void ("aa".search(r));
  return [before, r.lastIndex];
}

function r6(r) {
  const before = r.lastIndex;
  void ("aa".split(r));
  return [before, r.lastIndex];
}

function r7(r) {
  const before = r.lastIndex;
  void ([..."aa".matchAll(r)]);
  return [before, r.lastIndex];
}

function r8(r) {
  const before = r.lastIndex;
  void (r[Symbol.replace]("aa", "b"));
  return [before, r.lastIndex];
}

function r9(r) {
  const before = r.lastIndex;
  void (RegExp.prototype.test.call(r, "aa"));
  return [before, r.lastIndex];
}

function r10(r) {
  const before = r.lastIndex;
  void (r.lastIndex = 1);
  return [before, r.lastIndex];
}

function r11(r) {
  const before = r.lastIndex;
  void (Reflect.set(r, "lastIndex", 1));
  return [before, r.lastIndex];
}

function r12(r) {
  const before = r.lastIndex;
  void (r.compile("b", "g"), r.test("ab"));
  return [before, r.lastIndex];
}

function r13(r) {
  const before = r.lastIndex;
  void (r.test("b"));
  return [before, r.lastIndex];
}

function r14(r) {
  const before = r.lastIndex;
  void ((r.lastIndex = 5, r.test("aa")));
  return [before, r.lastIndex];
}

function m1(m) {
  const before = [m.get("k"), m.size, m.has("k")];
  void (m.set("k", "changed"));
  return [before, [m.get("k"), m.size, m.has("k")]];
}

function m2(m) {
  const before = [m.get("k"), m.size, m.has("k")];
  void (m.set("j", 1));
  return [before, [m.get("k"), m.size, m.has("k")]];
}

function m3(m) {
  const before = [m.get("k"), m.size, m.has("k")];
  void (m.delete("k"));
  return [before, [m.get("k"), m.size, m.has("k")]];
}

function m4(m) {
  const before = [m.get("k"), m.size, m.has("k")];
  void (m.clear());
  return [before, [m.get("k"), m.size, m.has("k")]];
}

function m5(m) {
  const before = [m.get("k"), m.size, m.has("k")];
  void (Map.prototype.set.call(m, "k", "changed"));
  return [before, [m.get("k"), m.size, m.has("k")]];
}

function m6(m) {
  const before = [m.get("k"), m.size, m.has("k")];
  void (Reflect.apply(Map.prototype.delete, m, ["k"]));
  return [before, [m.get("k"), m.size, m.has("k")]];
}

function m7(m) {
  const before = [m.get("k"), m.size, m.has("k")];
  void (m.getOrInsert("k", "not taken"));
  return [before, [m.get("k"), m.size, m.has("k")]];
}

function m8(m) {
  const before = [m.get("k"), m.size, m.has("k")];
  void (m.getOrInsert("j", "taken"));
  return [before, [m.get("k"), m.size, m.has("k")]];
}

function m9(m) {
  const before = [m.get("k"), m.size, m.has("k")];
  void (m.getOrInsertComputed("j", () => m.set("k", "changed in the callback")));
  return [before, [m.get("k"), m.size, m.has("k")]];
}

function m10(m) {
  const before = [m.get("k"), m.size, m.has("k")];
  void (m.forEach((value, key, map) => map.set(key, "changed")));
  return [before, [m.get("k"), m.size, m.has("k")]];
}

function m11(m) {
  const before = [m.get("k"), m.size, m.has("k")];
  void (new Map(m).set("k", "of the copy"));
  return [before, [m.get("k"), m.size, m.has("k")]];
}

function m12(m) {
  const before = [m.get("k"), m.size, m.has("k")];
  void (structuredClone(m).clear());
  return [before, [m.get("k"), m.size, m.has("k")]];
}

function s1(s) {
  const before = [s.has("k"), s.size];
  void (s.add("j"));
  return [before, [s.has("k"), s.size]];
}

function s2(s) {
  const before = [s.has("k"), s.size];
  void (s.delete("k"));
  return [before, [s.has("k"), s.size]];
}

function s3(s) {
  const before = [s.has("k"), s.size];
  void (s.clear());
  return [before, [s.has("k"), s.size]];
}

function s4(s) {
  const before = [s.has("k"), s.size];
  void (Set.prototype.delete.call(s, "k"));
  return [before, [s.has("k"), s.size]];
}

function s5(s) {
  const before = [s.has("k"), s.size];
  void (s.forEach((value, same, set) => set.delete(value)));
  return [before, [s.has("k"), s.size]];
}

function s6(s) {
  const before = [s.has("k"), s.size];
  void (s.union(new Set(["j"])));
  return [before, [s.has("k"), s.size]];
}

function s7(s) {
  const before = [s.has("k"), s.size];
  void (new Set(s).clear());
  return [before, [s.has("k"), s.size]];
}

function d1(d) {
  const before = d.getTime();
  void (d.setTime(5));
  return [before, d.getTime()];
}

function d2(d) {
  const before = d.getTime();
  void (d.setUTCFullYear(1971));
  return [before, d.getTime()];
}

function d3(d) {
  const before = d.getTime();
  void (d.setUTCMilliseconds(7));
  return [before, d.getTime()];
}

function d4(d) {
  const before = d.getTime();
  void (Date.prototype.setTime.call(d, 5));
  return [before, d.getTime()];
}

function d5(d) {
  const before = d.getTime();
  void (Reflect.apply(Date.prototype.setTime, d, [5]));
  return [before, d.getTime()];
}

function d6(d) {
  const before = d.getTime();
  void (d.setTime(NaN));
  return [before, d.getTime()];
}

function d7(d) {
  const before = d.getTime();
  void (new Date(d).setTime(5));
  return [before, d.getTime()];
}

console.log("strict:", (function () { return this === undefined; })());
attempt("an object: o.y = \"changed\"", () => o1({ x: 1, y: "same" }));
attempt("an object: o[\"y\"] = \"changed\"", () => o2({ x: 1, y: "same" }));
attempt("an object: Object.assign(o, { y: \"changed\" })", () => o3({ x: 1, y: "same" }));
attempt("an object: Reflect.set(o, \"y\", \"changed\")", () => o4({ x: 1, y: "same" }));
attempt("an object: Reflect.set({}, \"y\", \"changed\", o)", () => o5({ x: 1, y: "same" }));
attempt("an object: Object.defineProperty(o, \"y\", { value: \"changed\" })", () => o6({ x: 1, y: "same" }));
attempt("an object: Object.defineProperty(o, \"y\", { get: () => \"got\" })", () => o7({ x: 1, y: "same" }));
attempt("an object: Object.defineProperties(o, { y: { value: \"changed\" } })", () => o8({ x: 1, y: "same" }));
attempt("an object: Reflect.defineProperty(o, \"y\", { value: \"changed\" })", () => o9({ x: 1, y: "same" }));
attempt("an object: delete o.y", () => o10({ x: 1, y: "same" }));
attempt("an object: Reflect.deleteProperty(o, \"y\")", () => o11({ x: 1, y: "same" }));
attempt("an object: Object.setPrototypeOf(o, { y: \"inherited\" }), delete o.y", () => o12({ x: 1, y: "same" }));
attempt("an object: Array.prototype.push.call(o, \"pushed\")", () => o13({ x: 1, y: "same" }));
attempt("an object: Array.prototype.fill.call(Object.assign(o, { length: 1 }), \"filled\")", () => o14({ x: 1, y: "same" }));
attempt("an object: Object.entries(o).forEach(([key]) => { o[key] = \"changed\"; })", () => o15({ x: 1, y: "same" }));
attempt("an object: JSON.parse(\"1\", () => { o.y = \"changed\"; })", () => o16({ x: 1, y: "same" }));
attempt("an object: JSON.stringify({ toJSON() { o.y = \"changed\"; } })", () => o17({ x: 1, y: "same" }));
attempt("an object: [0].forEach(function () { this.y = \"changed\"; }, o)", () => o18({ x: 1, y: "same" }));
attempt("an object: (function () { this.y = \"changed\"; }).call(o)", () => o19({ x: 1, y: "same" }));
attempt("an object: Reflect.apply(function () { this.y = \"changed\"; }, o, [])", () => o20({ x: 1, y: "same" }));
attempt("an object: Object.getOwnPropertyDescriptor({ set k(value) { o.y = value; } }, \"k\").set(\"changed\")", () => o21({ x: 1, y: "same" }));
attempt("an object: Object.freeze(o), Reflect.set(o, \"y\", \"changed\")", () => o22({ x: 1, y: "same" }));
attempt("an object: new Proxy(o, {}).y = \"changed\"", () => o23({ x: 1, y: "same" }));
attempt("an object: Object.create(o).y = \"own of the heir\"", () => o24({ x: 1, y: "same" }));
attempt("an object: Object.create(new Proxy(o, {})).y = \"through the proxy\"", () => o25({ x: 1, y: "same" }));
attempt("an object: structuredClone(o).y = \"of the clone\"", () => o26({ x: 1, y: "same" }));
attempt("an object: ({ ...o }).y = \"of the copy\"", () => o27({ x: 1, y: "same" }));
attempt("an array: a[0] = \"changed\"", () => a1(["same", "other"]));
attempt("an array: a.reverse()", () => a2(["same", "other"]));
attempt("an array: a.sort()", () => a3(["same", "other"]));
attempt("an array: a.fill(\"changed\")", () => a4(["same", "other"]));
attempt("an array: a.copyWithin(0, 1)", () => a5(["same", "other"]));
attempt("an array: a.splice(0, 1, \"changed\")", () => a6(["same", "other"]));
attempt("an array: a.splice(0)", () => a7(["same", "other"]));
attempt("an array: a.shift()", () => a8(["same", "other"]));
attempt("an array: a.unshift(\"changed\")", () => a9(["same", "other"]));
attempt("an array: a.pop()", () => a10(["same", "other"]));
attempt("an array: a.push(\"pushed\")", () => a11(["same", "other"]));
attempt("an array: a.length = 0", () => a12(["same", "other"]));
attempt("an array: a.length = 5", () => a13(["same", "other"]));
attempt("an array: Array.prototype.reverse.call(a)", () => a14(["same", "other"]));
attempt("an array: Reflect.apply(Array.prototype.fill, a, [\"changed\"])", () => a15(["same", "other"]));
attempt("an array: [].push.apply(a, [\"pushed\", \"twice\"])", () => a16(["same", "other"]));
attempt("an array: Reflect.set(a, 0, \"changed\")", () => a17(["same", "other"]));
attempt("an array: Reflect.set(a, \"0\", \"changed\")", () => a18(["same", "other"]));
attempt("an array: Reflect.set(a, \"length\", 0)", () => a19(["same", "other"]));
attempt("an array: Object.assign(a, [\"changed\"])", () => a20(["same", "other"]));
attempt("an array: Object.assign(a, { length: 0 })", () => a21(["same", "other"]));
attempt("an array: Object.defineProperty(a, 0, { value: \"changed\" })", () => a22(["same", "other"]));
attempt("an array: Object.defineProperty(a, 0, { get: () => \"got\" })", () => a23(["same", "other"]));
attempt("an array: Object.defineProperty(a, \"length\", { value: 0 })", () => a24(["same", "other"]));
attempt("an array: delete a[0]", () => a25(["same", "other"]));
attempt("an array: Reflect.deleteProperty(a, 0)", () => a26(["same", "other"]));
attempt("an array: new Proxy(a, {})[0] = \"changed\"", () => a27(["same", "other"]));
attempt("an array: new Proxy(a, {}).length = 0", () => a28(["same", "other"]));
attempt("an array: a.forEach((x, i, list) => { list[i] = \"changed\"; })", () => a29(["same", "other"]));
attempt("an array: a.map((x, i, list) => list.pop())", () => a30(["same", "other"]));
attempt("an array: a.sort(() => { a[0] = \"changed in the comparator\"; return 0; })", () => a31(["same", "other"]));
attempt("an array: a.toSorted()", () => a32(["same", "other"]));
attempt("an array: a.with(0, \"of the copy\")", () => a33(["same", "other"]));
attempt("an array: a.slice().reverse()", () => a34(["same", "other"]));
attempt("an array: a.concat().fill(\"of the copy\")", () => a35(["same", "other"]));
attempt("an array: Object.freeze(a), Reflect.set(a, 0, \"changed\")", () => a36(["same", "other"]));
attempt("a typed array: u[0] = 9", () => u1(Uint8Array.of(1, 2)));
attempt("a typed array: u.set([9])", () => u2(Uint8Array.of(1, 2)));
attempt("a typed array: u.fill(9)", () => u3(Uint8Array.of(1, 2)));
attempt("a typed array: u.reverse()", () => u4(Uint8Array.of(1, 2)));
attempt("a typed array: u.sort((x, y) => y - x)", () => u5(Uint8Array.of(1, 2)));
attempt("a typed array: u.copyWithin(0, 1)", () => u6(Uint8Array.of(1, 2)));
attempt("a typed array: new Uint8Array(u.buffer)[0] = 9", () => u7(Uint8Array.of(1, 2)));
attempt("a typed array: new Uint16Array(u.buffer)[0] = 0x0909", () => u8(Uint8Array.of(1, 2)));
attempt("a typed array: new DataView(u.buffer).setUint8(0, 9)", () => u9(Uint8Array.of(1, 2)));
attempt("a typed array: Atomics.store(u, 0, 9)", () => u10(Uint8Array.of(1, 2)));
attempt("a typed array: Atomics.add(u, 0, 8)", () => u11(Uint8Array.of(1, 2)));
attempt("a typed array: new TextEncoder().encodeInto(\"z\", u)", () => u12(Uint8Array.of(1, 2)));
attempt("a typed array: Buffer.from(u.buffer).write(\"z\")", () => u13(Uint8Array.of(1, 2)));
attempt("a typed array: Buffer.from(u.buffer).fill(9)", () => u14(Uint8Array.of(1, 2)));
attempt("a typed array: u.subarray(0, 1).fill(9)", () => u15(Uint8Array.of(1, 2)));
attempt("a typed array: u.slice(0, 1).fill(9)", () => u16(Uint8Array.of(1, 2)));
attempt("a typed array: Reflect.set(u, 0, 9)", () => u17(Uint8Array.of(1, 2)));
attempt("a typed array: Object.assign(u, [9])", () => u18(Uint8Array.of(1, 2)));
attempt("a typed array: Object.defineProperty(u, 0, { value: 9 })", () => u19(Uint8Array.of(1, 2)));
attempt("a typed array: structuredClone(u.buffer, { transfer: [u.buffer] })", () => u20(Uint8Array.of(1, 2)));
attempt("a typed array: u.buffer.transfer()", () => u21(Uint8Array.of(1, 2)));
attempt("a typed array: u.buffer.transfer(1)", () => u22(Uint8Array.of(1, 2)));
attempt("a typed array: new MessageChannel().port1.postMessage(null, [u.buffer])", () => u23(Uint8Array.of(1, 2)));
attempt("a typed array: Uint8Array.prototype.set.call(u, { length: 1, 0: 9 })", () => u24(Uint8Array.of(1, 2)));
attempt("a pattern: r.test(\"aa\")", () => r1(/a/g));
attempt("a pattern: r.exec(\"aa\")", () => r2(/a/g));
attempt("a pattern: \"aa\".match(r)", () => r3(/a/g));
attempt("a pattern: \"aa\".replace(r, \"b\")", () => r4(/a/g));
attempt("a pattern: \"aa\".search(r)", () => r5(/a/g));
attempt("a pattern: \"aa\".split(r)", () => r6(/a/g));
attempt("a pattern: [...\"aa\".matchAll(r)]", () => r7(/a/g));
attempt("a pattern: r[Symbol.replace](\"aa\", \"b\")", () => r8(/a/g));
attempt("a pattern: RegExp.prototype.test.call(r, \"aa\")", () => r9(/a/g));
attempt("a pattern: r.lastIndex = 1", () => r10(/a/g));
attempt("a pattern: Reflect.set(r, \"lastIndex\", 1)", () => r11(/a/g));
attempt("a pattern: r.compile(\"b\", \"g\"), r.test(\"ab\")", () => r12(/a/g));
attempt("a pattern: r.test(\"b\")", () => r13(/a/g));
attempt("a pattern: (r.lastIndex = 5, r.test(\"aa\"))", () => r14(/a/g));
attempt("a map: m.set(\"k\", \"changed\")", () => m1(new Map([["k", "same"]])));
attempt("a map: m.set(\"j\", 1)", () => m2(new Map([["k", "same"]])));
attempt("a map: m.delete(\"k\")", () => m3(new Map([["k", "same"]])));
attempt("a map: m.clear()", () => m4(new Map([["k", "same"]])));
attempt("a map: Map.prototype.set.call(m, \"k\", \"changed\")", () => m5(new Map([["k", "same"]])));
attempt("a map: Reflect.apply(Map.prototype.delete, m, [\"k\"])", () => m6(new Map([["k", "same"]])));
attempt("a map: m.getOrInsert(\"k\", \"not taken\")", () => m7(new Map([["k", "same"]])));
attempt("a map: m.getOrInsert(\"j\", \"taken\")", () => m8(new Map([["k", "same"]])));
attempt("a map: m.getOrInsertComputed(\"j\", () => m.set(\"k\", \"changed in the callback\"))", () => m9(new Map([["k", "same"]])));
attempt("a map: m.forEach((value, key, map) => map.set(key, \"changed\"))", () => m10(new Map([["k", "same"]])));
attempt("a map: new Map(m).set(\"k\", \"of the copy\")", () => m11(new Map([["k", "same"]])));
attempt("a map: structuredClone(m).clear()", () => m12(new Map([["k", "same"]])));
attempt("a set: s.add(\"j\")", () => s1(new Set(["k"])));
attempt("a set: s.delete(\"k\")", () => s2(new Set(["k"])));
attempt("a set: s.clear()", () => s3(new Set(["k"])));
attempt("a set: Set.prototype.delete.call(s, \"k\")", () => s4(new Set(["k"])));
attempt("a set: s.forEach((value, same, set) => set.delete(value))", () => s5(new Set(["k"])));
attempt("a set: s.union(new Set([\"j\"]))", () => s6(new Set(["k"])));
attempt("a set: new Set(s).clear()", () => s7(new Set(["k"])));
attempt("a date: d.setTime(5)", () => d1(new Date(0)));
attempt("a date: d.setUTCFullYear(1971)", () => d2(new Date(0)));
attempt("a date: d.setUTCMilliseconds(7)", () => d3(new Date(0)));
attempt("a date: Date.prototype.setTime.call(d, 5)", () => d4(new Date(0)));
attempt("a date: Reflect.apply(Date.prototype.setTime, d, [5])", () => d5(new Date(0)));
attempt("a date: d.setTime(NaN)", () => d6(new Date(0)));
attempt("a date: new Date(d).setTime(5)", () => d7(new Date(0)));
