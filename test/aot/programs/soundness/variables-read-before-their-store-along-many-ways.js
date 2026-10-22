// A variable is read before its store, along ways of different length. `var` answers undefined, `let`, `const` and `class` throw.
const out = [];
function show(name, v) { out.push(name + ": " + typeof v + " " + String(v)); }
function attempt(f) { try { return f(); } catch (e) { return e.constructor.name; } }
function run(f) { return f(); }
function run2(f) { return run(() => run(f)); }

// hoisted function, direct call
show("var direct", r1()); function r1() { const t = v1; return t === undefined ? "missing" : t + 1; } var v1 = 1; show("var direct after", r1());
show("let direct", attempt(r2)); function r2() { return v2 + 1; } let v2 = 1; show("let direct after", attempt(r2));
show("const direct", attempt(r3)); function r3() { return v3 + 1; } const v3 = 1; show("const direct after", attempt(r3));
show("class direct", attempt(r4)); function r4() { return new V4().x + 1; } class V4 { x = 1; } show("class direct after", attempt(r4));

// through callbacks
show("var callback", run2(r5)); function r5() { const t = v5; return t === undefined ? "missing" : t + 1; } var v5 = 1;
show("var map", [0].map(r6)[0]); function r6() { const t = v6; return t === undefined ? "missing" : t + 1; } var v6 = 1;
show("var sort", (() => { let s; [2, 1].sort(() => { s = r7(); return 0; }); return s; })()); function r7() { const t = v7; return t === undefined ? "missing" : t + 1; } var v7 = 1;
show("var getter", ({ get g() { return r8(); } }).g); function r8() { const t = v8; return t === undefined ? "missing" : t + 1; } var v8 = 1;
show("var toString", `${{ toString() { return r9(); } }}`); function r9() { const t = v9; return t === undefined ? "missing" : "" + (t + 1); } var v9 = 1;
show("var proxy", new Proxy({}, { get() { return r10(); } }).x); function r10() { const t = v10; return t === undefined ? "missing" : t + 1; } var v10 = 1;
show("var constructor", new (class { constructor() { this.r = r11(); } })().r); function r11() { const t = v11; return t === undefined ? "missing" : t + 1; } var v11 = 1;
show("var static block", (class { static r; static { this.r = r12(); } }).r); function r12() { const t = v12; return t === undefined ? "missing" : t + 1; } var v12 = 1;
show("var generator", (function* () { yield r13(); })().next().value); function r13() { const t = v13; return t === undefined ? "missing" : t + 1; } var v13 = 1;
show("var iterator", [...{ *[Symbol.iterator]() { yield r14(); } }][0]); function r14() { const t = v14; return t === undefined ? "missing" : t + 1; } var v14 = 1;
show("var default", ((a = r15()) => a)()); function r15() { const t = v15; return t === undefined ? "missing" : t + 1; } var v15 = 1;
show("var bound", r16.bind(null)()); function r16() { const t = v16; return t === undefined ? "missing" : t + 1; } var v16 = 1;
show("var call", r17.call(null)); function r17() { const t = v17; return t === undefined ? "missing" : t + 1; } var v17 = 1;
show("var Reflect", Reflect.apply(r18, null, [])); function r18() { const t = v18; return t === undefined ? "missing" : t + 1; } var v18 = 1;
show("var table", ({ f: r19 })["f"]()); function r19() { const t = v19; return t === undefined ? "missing" : t + 1; } var v19 = 1;
show("var array", [r20][0]()); function r20() { const t = v20; return t === undefined ? "missing" : t + 1; } var v20 = 1;
show("var replace", "a".replace("a", r21)); function r21() { const t = v21; return t === undefined ? "missing" : "" + (t + 1); } var v21 = 1;
show("var json", JSON.stringify({ toJSON: r22 })); function r22() { const t = v22; return t === undefined ? "missing" : t + 1; } var v22 = 1;
show("var tag", r23``); function r23() { const t = v23; return t === undefined ? "missing" : t + 1; } var v23 = 1;
show("var new", new r24().r); function r24() { const t = v24; this.r = t === undefined ? "missing" : t + 1; } var v24 = 1;
show("var thenable", (() => { let s; Promise.resolve({ then() { } }); new Promise(() => { s = r25(); }); return s; })()); function r25() { const t = v25; return t === undefined ? "missing" : t + 1; } var v25 = 1;

// a closure stored in a variable, then read and called
var f26 = () => { const t = v26; return t === undefined ? "missing" : t + 1; }; show("stored closure", f26()); var v26 = 1; show("stored closure after", f26());
const o27 = { m() { const t = v27; return t === undefined ? "missing" : t + 1; } }; show("stored method", o27.m()); var v27 = 1;
class C28 { m() { const t = v28; return t === undefined ? "missing" : t + 1; } static s() { const t = v28; return t === undefined ? "missing" : t + 1; } } show("class method", new C28().m()); show("static method", C28.s()); var v28 = 1;
class B29 { m() { const t = v29; return t === undefined ? "missing" : t + 1; } } class D29 extends B29 { } show("inherited method", new D29().m()); var v29 = 1;

// the store is in a function
function set30() { v30 = 1; } function r30() { const t = v30; return t === undefined ? "missing" : t + 1; } var v30; show("store in function, before", r30()); set30(); show("store in function, after", r30());
function set31(c) { if (c) v31 = 1; } function r31() { const t = v31; return t === undefined ? "missing" : t + 1; } var v31; set31(false); show("conditional store", r31()); set31(true); show("conditional store after", r31());
function set32() { boom32(); v32 = 1; } function boom32() { throw 0; } function r32() { const t = v32; return t === undefined ? "missing" : t + 1; } var v32; try { set32(); } catch { } show("store after a throw", r32());
var v33; try { boom32(); v33 = 1; } catch { } show("store in try", (() => { const t = v33; return t === undefined ? "missing" : t + 1; })());
var v34; for (const i of []) v34 = 1; show("store in empty loop", (() => { const t = v34; return t === undefined ? "missing" : t + 1; })());
var v35; false && (v35 = 1); show("store behind &&", (() => { const t = v35; return t === undefined ? "missing" : t + 1; })());

// stored once?
let w36 = 1; function again36() { w36 = "two"; } function r36() { return w36 + 1; } show("second store, before", r36()); run2(again36); show("second store, after", r36());
let w37 = 1; const t37 = { a() { }, undefined() { w37 = "two"; } }; var k37u; function r37() { return w37 + 1; } t37[k37u](); var k37u = "a"; show("second store by late key", r37());
let w38 = 1; for (let i = 0; i < 2; i++) { w38 = w38 + 0.5; } show("store in loop", w38 + 1);
let w39 = 1; function inc39() { w39++; } inc39(); inc39(); show("increment", w39 + 1);
let w40 = 1; ({ w40 } = { w40: "two" }); show("destructuring store", w40 + 1);
let w41 = 1; [w41] = ["two"]; show("array destructuring store", w41 + 1);
let w42 = 1; for (w42 of ["two"]); show("for-of store", w42 + 1);
let w43 = 1; for (w43 in { two: 0 }); show("for-in store", w43 + 1);
let w44 = 1; try { throw "two"; } catch (e) { w44 = e; } show("catch store", w44 + 1);
let w45 = 1; w45 ||= 5; w45 &&= "two"; show("logical assignment", w45 + 1);

console.log(out.join("\n"));
