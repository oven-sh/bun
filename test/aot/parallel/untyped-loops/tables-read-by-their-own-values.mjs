// Tables that a loop reads by their own values: values that are no names, undefined, texts made at run time, names above, tables that are changed, extended and frozen; states in variables of the module, locals, parameters and fields.
let reads = 0;
const T0 = { run: "x1", x1: "run", length: "x1", wait: "__proto__" }; const keep0 = JSON.stringify(T0);
Object.setPrototypeOf(T0, { gone: "run" });
function m0(c) { let n = 0, o = "", prev, s = "run"; for (let k = 0; k < c; k++) { s = T0[s]; n += s === undefined ? 1 : 2; if (k === 4) s = "run"; } return [n, o.length, String(s), String(prev), reads].join(); }
const T1 = { length: "constructor", idle: "idle", wait: "length" }; const keep1 = JSON.stringify(T1);
class M1 { s = "l" + "ength"; run(c) { let n = 0, o = ""; for (let k = 0; k < c; k++) { this.s = T1[this.s]; n += (this.s + "").length; } return [n, String(this.s)].join(); } } function m1(c) { return new M1().run(c); }
const T2 = { b: "stop", length: ["a"], idle: "length", stop: ["a"], run: "constructor", done: "stop" }; const keep2 = JSON.stringify(T2);
class M2 { s = "gone"; run(c) { let n = 0, o = ""; for (let k = 0; k < c; k++) { this.s = T2[this.s]; n += (this.s + "").length; } return [n, String(this.s)].join(); } } function m2(c) { return new M2().run(c); }
let T3 = { toString: "stop", b: "stop", stop: "gone", done: "idle", length: "length", idle: "length" }; const keep3 = JSON.stringify(T3);
let s3 = "toString"; function m3(c) { let n = 0, o = "", prev; for (let k = 0; k < c; k++) { s3 = T3[s3]; n += s3 === undefined ? 1 : 2; if (k === 10) T3.idle = "__proto__"; } return [n, o.length, String(s3), reads].join(); }
const T4 = { b: "toString", x1: "c", c: "x1", wait: null, done: "b", toString: "x1" }; const keep4 = JSON.stringify(T4);
function w4(T, c, s) { let n = 0, o = "", prev; for (let k = 0; k < c; k++) { s = T[s]; n += (s + "").length; if (s === undefined) s = "b"; } return [n, o.length, String(s), reads].join(); } function m4(c) { return w4(T4, c, "b") + w4({ b: "toString", toString: "b" }, c, "b"); }
const T5 = { x1: "run", c: "c", run: "run" }; const keep5 = JSON.stringify(T5);
Object.setPrototypeOf(T5, { gone: "x1" });
function w5(T, c, s) { let n = 0, o = "", prev; for (let k = 0; k < c; k++) { s = T[s]; n += s === undefined ? 1 : 2;  } return [n, o.length, String(s), reads].join(); } function m5(c) { return w5(T5, c, ["x1"].join("")) + w5({ x1: "run", run: "x1" }, c, "x1"); }
for (let round = 0; round < 30; round++) for (const m of [m0, m1, m2, m3, m4, m5]) {
    let answer; try { answer = m(round < 3 ? round : 40); } catch (e) { answer = e.name; }
    if (round < 6 || round > 26) console.log(m.name, round, answer);
}
console.log(JSON.stringify(T0), JSON.stringify(T1), JSON.stringify(T2), JSON.stringify(T3), JSON.stringify(T4), JSON.stringify(T5), reads);
