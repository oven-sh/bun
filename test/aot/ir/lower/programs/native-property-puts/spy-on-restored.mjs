// RUN: lower
// OPTIONS: builtin-modules

// mockRestore() puts the original member back. Each block hands it another kind of object.
import { spyOn } from "bun:test";
const keyOf = k => [k][0];
function see(o, k) {
  const d = Object.getOwnPropertyDescriptor(o, keyOf(k));
  const v = (() => { try { return typeof o[keyOf(k)]; } catch (e) { return "throws"; } })();
  return [v, d ? [("value" in d) ? typeof d.value : "-", typeof d.get, typeof d.set, d.writable, d.enumerable, d.configurable].join() : "none",
    Reflect.ownKeys(o).map(String).join(), Object.keys(o).join(), Object.hasOwn(o, keyOf(k)), keyOf(k) in o];
}
{
  const out = ["static-field m"];
  class A { static a = 1; static m = 1; static b = 2; static read() { return typeof A.m; } static sum() { return A.a + A.b; } }
  try { { const s = spyOn(A, "m"); s.mockImplementation(() => "mocked"); s.mockRestore(); } } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(A.read(), A.sum(), typeof A.m, see(A, "m"));
  console.log(JSON.stringify(out));
}
{
  const out = ["static-field-function m"];
  class A { static a = 1; static m = () => "original"; static b = 2; static read() { return A.m(); } }
  try { { const s = spyOn(A, "m"); s.mockImplementation(() => "mocked"); s.mockRestore(); } } catch (e) { out.push("throws " + e.constructor.name); }
  out.push((() => { try { return A.read(); } catch (e) { return "throws"; } })(), see(A, "m"));
  console.log(JSON.stringify(out));
}
{
  const out = ["static-field-listed-first m"];
  class A { static a = 1; static m = 1; static b = 2; static read() { return typeof A.m; } }
  const before = Object.keys(A).join();
  try { { const s = spyOn(A, "m"); s.mockImplementation(() => "mocked"); s.mockRestore(); } } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(A.read(), before, see(A, "m"));
  console.log(JSON.stringify(out));
}
{
  const out = ["static-field-with-subclass m"];
  class A { static a = 1; static m = 1; static read() { return typeof A.m; } }
  class B extends A { static readB() { return typeof B.m; } }
  try { { const s = spyOn(A, "m"); s.mockImplementation(() => "mocked"); s.mockRestore(); } } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(A.read(), B.readB(), see(A, "m"));
  console.log(JSON.stringify(out));
}
{
  const out = ["static-field-of-base m"];
  class A { static a = 1; static m = 1; static read() { return typeof A.m; } }
  class B extends A { static c = 3; static readB() { return typeof B.m; } }
  try { { const s = spyOn(B, "m"); s.mockImplementation(() => "mocked"); s.mockRestore(); } } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(A.read(), B.readB(), see(B, "m"));
  console.log(JSON.stringify(out));
}
{
  const out = ["static-field-stored-after m"];
  class A { static m = 1; static read() { return A.m; } static write(v) { A.m = v; } }
  try { { const s = spyOn(A, "m"); s.mockImplementation(() => "mocked"); s.mockRestore(); } } catch (e) { out.push("throws " + e.constructor.name); }
  try { A.write(5); } catch (e) { out.push("write throws"); }
  out.push(typeof A.read(), A.read() === 5, see(A, "m"));
  console.log(JSON.stringify(out));
}
{
  const out = ["static-method m"];
  class A { static a = 1; static m() { return "original"; } static other() { return 2; } static read() { return typeof A.m; } static call() { return A.m(); } }
  try { { const s = spyOn(A, "m"); s.mockImplementation(() => "mocked"); s.mockRestore(); } } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(A.read(), (() => { try { return A.call(); } catch (e) { return "throws"; } })(), A.other(), see(A, "m"));
  console.log(JSON.stringify(out));
}
{
  const out = ["static-getter m"];
  class A { static get m() { return 1; } static read() { return typeof A.m; } }
  try { { const s = spyOn(A, "m"); s.mockImplementation(() => "mocked"); s.mockRestore(); } } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(A.read(), see(A, "m"));
  console.log(JSON.stringify(out));
}
{
  const out = ["static-absent m"];
  class A { static a = 1; static b = 2; static other() { return 2; } static read() { return typeof A.m; } }
  try { { const s = spyOn(A, "m"); s.mockImplementation(() => "mocked"); s.mockRestore(); } } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(A.read(), A.a + A.b, see(A, "m"));
  console.log(JSON.stringify(out));
}
{
  const out = ["static-frozen m"];
  class A { static a = 1; static m = 1; static read() { return typeof A.m; } }
  Object.freeze(A);
  try { { const s = spyOn(A, "m"); s.mockImplementation(() => "mocked"); s.mockRestore(); } } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(A.read(), Object.isFrozen(A), see(A, "m"));
  console.log(JSON.stringify(out));
}
{
  const out = ["prototype-method m"];
  class A { a() { return 1; } m() { return "original"; } b() { return 2; } read() { return typeof this.m; } call() { return this.m(); } }
  try { { const s = spyOn(A.prototype, "m"); s.mockImplementation(() => "mocked"); s.mockRestore(); } } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(new A().read(), (() => { try { return new A().call(); } catch (e) { return "throws"; } })(), new A().a() + new A().b(), see(A.prototype, "m"));
  console.log(JSON.stringify(out));
}
{
  const out = ["prototype-getter m"];
  class A { get m() { return 1; } read() { return typeof this.m; } }
  try { { const s = spyOn(A.prototype, "m"); s.mockImplementation(() => "mocked"); s.mockRestore(); } } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(new A().read(), see(A.prototype, "m"));
  console.log(JSON.stringify(out));
}
{
  const out = ["prototype-absent m"];
  class A { a() { return 1; } read() { return typeof this.m; } }
  try { { const s = spyOn(A.prototype, "m"); s.mockImplementation(() => "mocked"); s.mockRestore(); } } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(new A().read(), new A().a(), see(A.prototype, "m"));
  console.log(JSON.stringify(out));
}
{
  const out = ["instance-field m"];
  class P { a = 1; m = 1; b = 2; read() { return typeof this.m; } }
  const p = new P();
  try { { const s = spyOn(p, "m"); s.mockImplementation(() => "mocked"); s.mockRestore(); } } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(p.read(), p.a + p.b, see(p, "m"));
  console.log(JSON.stringify(out));
}
{
  const out = ["instance-absent m"];
  class P { a = 1; read() { return typeof this.m; } }
  const p = new P(), q = new P();
  try { { const s = spyOn(p, "m"); s.mockImplementation(() => "mocked"); s.mockRestore(); } } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(p.read(), q.read(), see(p, "m"));
  console.log(JSON.stringify(out));
}
{
  const out = ["instance-frozen m"];
  class P { a = 1; m = 1; read() { return typeof this.m; } }
  const p = Object.freeze(new P());
  try { { const s = spyOn(p, "m"); s.mockImplementation(() => "mocked"); s.mockRestore(); } } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(p.read(), Object.isFrozen(p), see(p, "m"));
  console.log(JSON.stringify(out));
}
{
  const out = ["literal-field m"];
  const o = { a: 1, m: 1, b: 2 };
  const read = () => typeof o.m;
  try { { const s = spyOn(o, "m"); s.mockImplementation(() => "mocked"); s.mockRestore(); } } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(read(), o.a + o.b, see(o, "m"));
  console.log(JSON.stringify(out));
}
{
  const out = ["literal-getter m"];
  const o = { a: 1, get m() { return 1; }, b: 2 };
  const read = () => typeof o.m;
  try { { const s = spyOn(o, "m"); s.mockImplementation(() => "mocked"); s.mockRestore(); } } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(read(), see(o, "m"));
  console.log(JSON.stringify(out));
}
{
  const out = ["literal-frozen m"];
  const o = Object.freeze({ a: 1, m: 1 });
  const read = () => typeof o.m;
  try { { const s = spyOn(o, "m"); s.mockImplementation(() => "mocked"); s.mockRestore(); } } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(read(), Object.isFrozen(o), see(o, "m"));
  console.log(JSON.stringify(out));
}
{
  const out = ["function-property m"];
  function f() { return 1; }
  f.a = 1; f.m = 1;
  const read = () => typeof f.m;
  try { { const s = spyOn(f, "m"); s.mockImplementation(() => "mocked"); s.mockRestore(); } } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(read(), f(), see(f, "m"));
  console.log(JSON.stringify(out));
}
{
  const out = ["function-absent m"];
  function f() { return 1; }
  const read = () => typeof f.m;
  try { { const s = spyOn(f, "m"); s.mockImplementation(() => "mocked"); s.mockRestore(); } } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(read(), f(), f.name, f.length, see(f, "m"));
  console.log(JSON.stringify(out));
}
{
  const out = ["arrow-absent m"];
  const f = (x) => 1;
  const read = () => typeof f.m;
  try { { const s = spyOn(f, "m"); s.mockImplementation(() => "mocked"); s.mockRestore(); } } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(read(), f(), f.name, f.length, see(f, "m"));
  console.log(JSON.stringify(out));
}
{
  const out = ["closure-absent m"];
  const make = (n) => (x) => n;
  const f = make(1), g = make(2);
  const read = (h) => typeof h.m;
  try { { const s = spyOn(f, "m"); s.mockImplementation(() => "mocked"); s.mockRestore(); } } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(read(f), read(g), f() + g(), see(f, "m"));
  console.log(JSON.stringify(out));
}
{
  const out = ["bound-absent m"];
  function t() { return 1; }
  const f = t.bind(null);
  const read = () => typeof f.m;
  try { { const s = spyOn(f, "m"); s.mockImplementation(() => "mocked"); s.mockRestore(); } } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(read(), f(), f.name, see(f, "m"));
  console.log(JSON.stringify(out));
}
{
  const out = ["lazy-class m"];
  class A { a() { return 1; } }
  class B { b() { return 1; } }
  try { { const s = spyOn(A, "m"); s.mockImplementation(() => "mocked"); s.mockRestore(); } } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(new A().a(), Reflect.ownKeys(B).join(), see(A, "m"));
  console.log(JSON.stringify(out));
}
{
  const out = ["lazy-class-second m"];
  class A { a() { return 1; } }
  class B { b() { return 1; } }
  try { { const s = spyOn(A, "m"); s.mockImplementation(() => "mocked"); s.mockRestore(); } } catch (e) { out.push("throws " + e.constructor.name); }
  try { { const s = spyOn(B, "m"); s.mockImplementation(() => "mocked"); s.mockRestore(); } } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(new B().b(), Reflect.ownKeys(A).join(), see(B, "m"));
  console.log(JSON.stringify(out));
}
{
  const out = ["static-field-alone m"];
  class A { static m = 1; }
  const read = () => typeof A.m;
  try { { const s = spyOn(A, "m"); s.mockImplementation(() => "mocked"); s.mockRestore(); } } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(read(), see(A, "m"));
  console.log(JSON.stringify(out));
}
{
  const out = ["static-field-and-getter m"];
  class A { static z = 1; static get g() { return 2; } static m = 1; static read() { return typeof A.m; } }
  try { { const s = spyOn(A, "m"); s.mockImplementation(() => "mocked"); s.mockRestore(); } } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(A.read(), A.g + A.z, see(A, "m"));
  console.log(JSON.stringify(out));
}
{
  const out = ["static-field-many-methods m"];
  class A { static f0() { return 0; } static f1() { return 1; } static f2() { return 2; } static f3() { return 3; } static f4() { return 4; } static f5() { return 5; } static f6() { return 6; } static f7() { return 7; } static f8() { return 8; } static f9() { return 9; } static f10() { return 10; } static f11() { return 11; } static f12() { return 12; } static f13() { return 13; } static f14() { return 14; } static f15() { return 15; } static f16() { return 16; } static f17() { return 17; } static f18() { return 18; } static f19() { return 19; } static f20() { return 20; } static f21() { return 21; } static f22() { return 22; } static f23() { return 23; } static f24() { return 24; } static f25() { return 25; } static f26() { return 26; } static f27() { return 27; } static f28() { return 28; } static f29() { return 29; } static f30() { return 30; } static f31() { return 31; } static f32() { return 32; } static f33() { return 33; } static f34() { return 34; } static f35() { return 35; } static f36() { return 36; } static f37() { return 37; } static f38() { return 38; } static f39() { return 39; } static f40() { return 40; } static f41() { return 41; } static f42() { return 42; } static f43() { return 43; } static f44() { return 44; } static f45() { return 45; } static f46() { return 46; } static f47() { return 47; } static f48() { return 48; } static f49() { return 49; } static f50() { return 50; } static f51() { return 51; } static f52() { return 52; } static f53() { return 53; } static f54() { return 54; } static f55() { return 55; } static f56() { return 56; } static f57() { return 57; } static f58() { return 58; } static f59() { return 59; } static f60() { return 60; } static f61() { return 61; } static f62() { return 62; } static f63() { return 63; } static f64() { return 64; } static f65() { return 65; } static f66() { return 66; } static f67() { return 67; } static f68() { return 68; } static f69() { return 69; } static f70() { return 70; } static f71() { return 71; } static f72() { return 72; } static f73() { return 73; } static f74() { return 74; } static f75() { return 75; } static f76() { return 76; } static f77() { return 77; } static f78() { return 78; } static f79() { return 79; } static f80() { return 80; } static f81() { return 81; } static f82() { return 82; } static f83() { return 83; } static f84() { return 84; } static f85() { return 85; } static f86() { return 86; } static f87() { return 87; } static f88() { return 88; } static f89() { return 89; } static a = 1; static m = 1; static b = 2; static read() { return typeof A.m; } }
  try { { const s = spyOn(A, "m"); s.mockImplementation(() => "mocked"); s.mockRestore(); } } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(A.read(), A.f3() + A.a + A.b, see(A, "m"));
  console.log(JSON.stringify(out));
}
{
  const out = ["static-field-behind-many-stores m"];
  class A { static a = 1; static { for (let i = 0; i < 120; i++) this["k" + i] = i; } static m = 1; static b = 2; static read() { return typeof A.m; } }
  try { { const s = spyOn(A, "m"); s.mockImplementation(() => "mocked"); s.mockRestore(); } } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(A.read(), A.k7 + A.a + A.b, see(A, "m"));
  console.log(JSON.stringify(out));
}
{
  const out = ["static-absent-behind-many-stores m"];
  class A { static a = 1; static { for (let i = 0; i < 120; i++) this["k" + i] = i; } static b = 2; static read() { return typeof A.m; } }
  try { { const s = spyOn(A, "m"); s.mockImplementation(() => "mocked"); s.mockRestore(); } } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(A.read(), A.k7 + A.a + A.b, see(A, "m"));
  console.log(JSON.stringify(out));
}
{
  const out = ["static-field-deleted-first m"];
  class A { static a = 1; static m = 1; static b = 2; static read() { return typeof A.m; } }
  delete A[keyOf("m")];
  try { { const s = spyOn(A, "m"); s.mockImplementation(() => "mocked"); s.mockRestore(); } } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(A.read(), A.a + A.b, see(A, "m"));
  console.log(JSON.stringify(out));
}
{
  const out = ["static-field-class-expression-in-loop m"];
  const made = [];
  for (let i = 0; i < 3; i++) made.push(class { static a = i; static m = i; static read() { return typeof this.m; } });
  const A = made[1];
  try { { const s = spyOn(A, "m"); s.mockImplementation(() => "mocked"); s.mockRestore(); } } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(A.read(), made[0].read(), made[2].read(), A.a, see(A, "m"));
  console.log(JSON.stringify(out));
}
{
  const out = ["proxy-of-class m"];
  class A { static m = 1; static read() { return typeof A.m; } }
  const o = new Proxy(A, {});
  try { { const s = spyOn(o, "m"); s.mockImplementation(() => "mocked"); s.mockRestore(); } } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(A.read(), see(A, "m"));
  console.log(JSON.stringify(out));
}
{
  const out = ["this-in-static-block m"];
  let seen;
  class A { static a = 1; static { try { { const s = spyOn(this, "m"); s.mockImplementation(() => "mocked"); s.mockRestore(); } } catch (e) { out.push("throws " + e.constructor.name); } } static b = 2; static read() { return typeof A.m; } }
  const o = A;
  out.push(A.read(), A.a + A.b, see(A, "m"));
  console.log(JSON.stringify(out));
}
{
  const out = ["static-field-later-than-put m"];
  class A { static a = 1; static { try { { const s = spyOn(this, "m"); s.mockImplementation(() => "mocked"); s.mockRestore(); } } catch (e) { out.push("throws " + e.constructor.name); } } static m = 2; static read() { return typeof A.m; } }
  out.push(A.read(), see(A, "m"));
  console.log(JSON.stringify(out));
}

// GENERATED: keyOf B write call g
// CHECK-LABEL: function {{*}}name="keyOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewArray v0 contents=anything
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: v4 = ElemGet v2, v3
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="B"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_3]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_3]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="B"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_5]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_5]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="write"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="A"
// CHECK-NEXT: v3 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PropSet v2, v3 key="m"
// CHECK-NEXT: v5 = Undefined
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="call"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="A"
// CHECK-NEXT: v2 = PropGet v1 key="m"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[f_10]] flags=[IsExpected]}
// CHECK-NEXT: v4 = Call v3, v1 calleeKey="m" calleeName="A.m"
// CHECK-NEXT: ReturnCall v4 casts=[{declared={type=undefined|null|string flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="call"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] thisType={type=[[L_11]] flags=[IsExpected]} results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_12]]] {
// CHECK-NEXT: b0(v0: [[L_11]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_11]] flags=[IsExpected]}
// CHECK-NEXT: v2 = PropGet v1 key="m"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[f_13]] flags=[IsExpected]}
// CHECK-NEXT: v4 = Call v3, v1 calleeKey="m" calleeName="this.m"
// CHECK-NEXT: ReturnCall v4 casts=[{declared={type=undefined|null|string flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="B"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_14]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_14]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_14]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="B"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_15]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_15]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_15]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="g"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasExplicitName] thisType={type=anything} results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=2
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
