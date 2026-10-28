// spyOn(o, "name") and spyOn(o, "length") on classes that declare static fields with those names. Each block hands it another kind of object.
import { spyOn } from "bun:test";
const keyOf = k => [k][0];
function see(o, k) {
  const d = Object.getOwnPropertyDescriptor(o, keyOf(k));
  const v = (() => { try { return typeof o[keyOf(k)]; } catch (e) { return "throws"; } })();
  return [v, d ? [("value" in d) ? typeof d.value : "-", typeof d.get, typeof d.set, d.writable, d.enumerable, d.configurable].join() : "none",
    Reflect.ownKeys(o).map(String).join(), Object.keys(o).join(), Object.hasOwn(o, keyOf(k)), keyOf(k) in o];
}
{
  const out = ["static-field name"];
  class A { static a = 1; static name = 1; static b = 2; static read() { return typeof A.name; } static sum() { return A.a + A.b; } }
  try { spyOn(A, "name"); } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(A.read(), A.sum(), typeof A.name, see(A, "name"));
  console.log(JSON.stringify(out));
}
{
  const out = ["static-field-function name"];
  class A { static a = 1; static name = () => "original"; static b = 2; static read() { return A.name(); } }
  try { spyOn(A, "name"); } catch (e) { out.push("throws " + e.constructor.name); }
  out.push((() => { try { return A.read(); } catch (e) { return "throws"; } })(), see(A, "name"));
  console.log(JSON.stringify(out));
}
{
  const out = ["static-field-listed-first name"];
  class A { static a = 1; static name = 1; static b = 2; static read() { return typeof A.name; } }
  const before = Object.keys(A).join();
  try { spyOn(A, "name"); } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(A.read(), before, see(A, "name"));
  console.log(JSON.stringify(out));
}
{
  const out = ["static-field-with-subclass name"];
  class A { static a = 1; static name = 1; static read() { return typeof A.name; } }
  class B extends A { static readB() { return typeof B.name; } }
  try { spyOn(A, "name"); } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(A.read(), B.readB(), see(A, "name"));
  console.log(JSON.stringify(out));
}
{
  const out = ["static-field-of-base name"];
  class A { static a = 1; static name = 1; static read() { return typeof A.name; } }
  class B extends A { static c = 3; static readB() { return typeof B.name; } }
  try { spyOn(B, "name"); } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(A.read(), B.readB(), see(B, "name"));
  console.log(JSON.stringify(out));
}
{
  const out = ["static-field-stored-after name"];
  class A { static name = 1; static read() { return A.name; } static write(v) { A.name = v; } }
  try { spyOn(A, "name"); } catch (e) { out.push("throws " + e.constructor.name); }
  try { A.write(5); } catch (e) { out.push("write throws"); }
  out.push(typeof A.read(), A.read() === 5, see(A, "name"));
  console.log(JSON.stringify(out));
}
{
  const out = ["static-method name"];
  class A { static a = 1; static name() { return "original"; } static other() { return 2; } static read() { return typeof A.name; } static call() { return A.name(); } }
  try { spyOn(A, "name"); } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(A.read(), (() => { try { return A.call(); } catch (e) { return "throws"; } })(), A.other(), see(A, "name"));
  console.log(JSON.stringify(out));
}
{
  const out = ["static-getter name"];
  class A { static get name() { return 1; } static read() { return typeof A.name; } }
  try { spyOn(A, "name"); } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(A.read(), see(A, "name"));
  console.log(JSON.stringify(out));
}
{
  const out = ["static-absent name"];
  class A { static a = 1; static b = 2; static other() { return 2; } static read() { return typeof A.name; } }
  try { spyOn(A, "name"); } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(A.read(), A.a + A.b, see(A, "name"));
  console.log(JSON.stringify(out));
}
{
  const out = ["static-frozen name"];
  class A { static a = 1; static name = 1; static read() { return typeof A.name; } }
  Object.freeze(A);
  try { spyOn(A, "name"); } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(A.read(), Object.isFrozen(A), see(A, "name"));
  console.log(JSON.stringify(out));
}
{
  const out = ["lazy-class name"];
  class A { a() { return 1; } }
  class B { b() { return 1; } }
  try { spyOn(A, "name"); } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(new A().a(), Reflect.ownKeys(B).join(), see(A, "name"));
  console.log(JSON.stringify(out));
}
{
  const out = ["lazy-class-second name"];
  class A { a() { return 1; } }
  class B { b() { return 1; } }
  try { spyOn(A, "name"); } catch (e) { out.push("throws " + e.constructor.name); }
  try { spyOn(B, "name"); } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(new B().b(), Reflect.ownKeys(A).join(), see(B, "name"));
  console.log(JSON.stringify(out));
}
{
  const out = ["static-field-alone name"];
  class A { static name = 1; }
  const read = () => typeof A.name;
  try { spyOn(A, "name"); } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(read(), see(A, "name"));
  console.log(JSON.stringify(out));
}
{
  const out = ["static-field-and-getter name"];
  class A { static z = 1; static get g() { return 2; } static name = 1; static read() { return typeof A.name; } }
  try { spyOn(A, "name"); } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(A.read(), A.g + A.z, see(A, "name"));
  console.log(JSON.stringify(out));
}
{
  const out = ["static-field-many-methods name"];
  class A { static f0() { return 0; } static f1() { return 1; } static f2() { return 2; } static f3() { return 3; } static f4() { return 4; } static f5() { return 5; } static f6() { return 6; } static f7() { return 7; } static f8() { return 8; } static f9() { return 9; } static f10() { return 10; } static f11() { return 11; } static f12() { return 12; } static f13() { return 13; } static f14() { return 14; } static f15() { return 15; } static f16() { return 16; } static f17() { return 17; } static f18() { return 18; } static f19() { return 19; } static f20() { return 20; } static f21() { return 21; } static f22() { return 22; } static f23() { return 23; } static f24() { return 24; } static f25() { return 25; } static f26() { return 26; } static f27() { return 27; } static f28() { return 28; } static f29() { return 29; } static f30() { return 30; } static f31() { return 31; } static f32() { return 32; } static f33() { return 33; } static f34() { return 34; } static f35() { return 35; } static f36() { return 36; } static f37() { return 37; } static f38() { return 38; } static f39() { return 39; } static f40() { return 40; } static f41() { return 41; } static f42() { return 42; } static f43() { return 43; } static f44() { return 44; } static f45() { return 45; } static f46() { return 46; } static f47() { return 47; } static f48() { return 48; } static f49() { return 49; } static f50() { return 50; } static f51() { return 51; } static f52() { return 52; } static f53() { return 53; } static f54() { return 54; } static f55() { return 55; } static f56() { return 56; } static f57() { return 57; } static f58() { return 58; } static f59() { return 59; } static f60() { return 60; } static f61() { return 61; } static f62() { return 62; } static f63() { return 63; } static f64() { return 64; } static f65() { return 65; } static f66() { return 66; } static f67() { return 67; } static f68() { return 68; } static f69() { return 69; } static f70() { return 70; } static f71() { return 71; } static f72() { return 72; } static f73() { return 73; } static f74() { return 74; } static f75() { return 75; } static f76() { return 76; } static f77() { return 77; } static f78() { return 78; } static f79() { return 79; } static f80() { return 80; } static f81() { return 81; } static f82() { return 82; } static f83() { return 83; } static f84() { return 84; } static f85() { return 85; } static f86() { return 86; } static f87() { return 87; } static f88() { return 88; } static f89() { return 89; } static a = 1; static name = 1; static b = 2; static read() { return typeof A.name; } }
  try { spyOn(A, "name"); } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(A.read(), A.f3() + A.a + A.b, see(A, "name"));
  console.log(JSON.stringify(out));
}
{
  const out = ["static-field-behind-many-stores name"];
  class A { static a = 1; static { for (let i = 0; i < 120; i++) this["k" + i] = i; } static name = 1; static b = 2; static read() { return typeof A.name; } }
  try { spyOn(A, "name"); } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(A.read(), A.k7 + A.a + A.b, see(A, "name"));
  console.log(JSON.stringify(out));
}
{
  const out = ["static-absent-behind-many-stores name"];
  class A { static a = 1; static { for (let i = 0; i < 120; i++) this["k" + i] = i; } static b = 2; static read() { return typeof A.name; } }
  try { spyOn(A, "name"); } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(A.read(), A.k7 + A.a + A.b, see(A, "name"));
  console.log(JSON.stringify(out));
}
{
  const out = ["static-field-deleted-first name"];
  class A { static a = 1; static name = 1; static b = 2; static read() { return typeof A.name; } }
  delete A[keyOf("name")];
  try { spyOn(A, "name"); } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(A.read(), A.a + A.b, see(A, "name"));
  console.log(JSON.stringify(out));
}
{
  const out = ["static-field-class-expression-in-loop name"];
  const made = [];
  for (let i = 0; i < 3; i++) made.push(class { static a = i; static name = i; static read() { return typeof this.name; } });
  const A = made[1];
  try { spyOn(A, "name"); } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(A.read(), made[0].read(), made[2].read(), A.a, see(A, "name"));
  console.log(JSON.stringify(out));
}
{
  const out = ["static-field-later-than-put name"];
  class A { static a = 1; static { try { spyOn(this, "name"); } catch (e) { out.push("throws " + e.constructor.name); } } static name = 2; static read() { return typeof A.name; } }
  out.push(A.read(), see(A, "name"));
  console.log(JSON.stringify(out));
}
{
  const out = ["static-field length"];
  class A { static a = 1; static length = 1; static b = 2; static read() { return typeof A.length; } static sum() { return A.a + A.b; } }
  try { spyOn(A, "length"); } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(A.read(), A.sum(), typeof A.length, see(A, "length"));
  console.log(JSON.stringify(out));
}
{
  const out = ["static-field-function length"];
  class A { static a = 1; static length = () => "original"; static b = 2; static read() { return A.length(); } }
  try { spyOn(A, "length"); } catch (e) { out.push("throws " + e.constructor.name); }
  out.push((() => { try { return A.read(); } catch (e) { return "throws"; } })(), see(A, "length"));
  console.log(JSON.stringify(out));
}
{
  const out = ["static-field-listed-first length"];
  class A { static a = 1; static length = 1; static b = 2; static read() { return typeof A.length; } }
  const before = Object.keys(A).join();
  try { spyOn(A, "length"); } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(A.read(), before, see(A, "length"));
  console.log(JSON.stringify(out));
}
{
  const out = ["static-field-with-subclass length"];
  class A { static a = 1; static length = 1; static read() { return typeof A.length; } }
  class B extends A { static readB() { return typeof B.length; } }
  try { spyOn(A, "length"); } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(A.read(), B.readB(), see(A, "length"));
  console.log(JSON.stringify(out));
}
{
  const out = ["static-field-of-base length"];
  class A { static a = 1; static length = 1; static read() { return typeof A.length; } }
  class B extends A { static c = 3; static readB() { return typeof B.length; } }
  try { spyOn(B, "length"); } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(A.read(), B.readB(), see(B, "length"));
  console.log(JSON.stringify(out));
}
{
  const out = ["static-field-stored-after length"];
  class A { static length = 1; static read() { return A.length; } static write(v) { A.length = v; } }
  try { spyOn(A, "length"); } catch (e) { out.push("throws " + e.constructor.name); }
  try { A.write(5); } catch (e) { out.push("write throws"); }
  out.push(typeof A.read(), A.read() === 5, see(A, "length"));
  console.log(JSON.stringify(out));
}
{
  const out = ["static-method length"];
  class A { static a = 1; static length() { return "original"; } static other() { return 2; } static read() { return typeof A.length; } static call() { return A.length(); } }
  try { spyOn(A, "length"); } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(A.read(), (() => { try { return A.call(); } catch (e) { return "throws"; } })(), A.other(), see(A, "length"));
  console.log(JSON.stringify(out));
}
{
  const out = ["static-getter length"];
  class A { static get length() { return 1; } static read() { return typeof A.length; } }
  try { spyOn(A, "length"); } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(A.read(), see(A, "length"));
  console.log(JSON.stringify(out));
}
{
  const out = ["static-absent length"];
  class A { static a = 1; static b = 2; static other() { return 2; } static read() { return typeof A.length; } }
  try { spyOn(A, "length"); } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(A.read(), A.a + A.b, see(A, "length"));
  console.log(JSON.stringify(out));
}
{
  const out = ["static-frozen length"];
  class A { static a = 1; static length = 1; static read() { return typeof A.length; } }
  Object.freeze(A);
  try { spyOn(A, "length"); } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(A.read(), Object.isFrozen(A), see(A, "length"));
  console.log(JSON.stringify(out));
}
{
  const out = ["lazy-class length"];
  class A { a() { return 1; } }
  class B { b() { return 1; } }
  try { spyOn(A, "length"); } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(new A().a(), Reflect.ownKeys(B).join(), see(A, "length"));
  console.log(JSON.stringify(out));
}
{
  const out = ["lazy-class-second length"];
  class A { a() { return 1; } }
  class B { b() { return 1; } }
  try { spyOn(A, "length"); } catch (e) { out.push("throws " + e.constructor.name); }
  try { spyOn(B, "length"); } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(new B().b(), Reflect.ownKeys(A).join(), see(B, "length"));
  console.log(JSON.stringify(out));
}
{
  const out = ["static-field-alone length"];
  class A { static length = 1; }
  const read = () => typeof A.length;
  try { spyOn(A, "length"); } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(read(), see(A, "length"));
  console.log(JSON.stringify(out));
}
{
  const out = ["static-field-and-getter length"];
  class A { static z = 1; static get g() { return 2; } static length = 1; static read() { return typeof A.length; } }
  try { spyOn(A, "length"); } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(A.read(), A.g + A.z, see(A, "length"));
  console.log(JSON.stringify(out));
}
{
  const out = ["static-field-many-methods length"];
  class A { static f0() { return 0; } static f1() { return 1; } static f2() { return 2; } static f3() { return 3; } static f4() { return 4; } static f5() { return 5; } static f6() { return 6; } static f7() { return 7; } static f8() { return 8; } static f9() { return 9; } static f10() { return 10; } static f11() { return 11; } static f12() { return 12; } static f13() { return 13; } static f14() { return 14; } static f15() { return 15; } static f16() { return 16; } static f17() { return 17; } static f18() { return 18; } static f19() { return 19; } static f20() { return 20; } static f21() { return 21; } static f22() { return 22; } static f23() { return 23; } static f24() { return 24; } static f25() { return 25; } static f26() { return 26; } static f27() { return 27; } static f28() { return 28; } static f29() { return 29; } static f30() { return 30; } static f31() { return 31; } static f32() { return 32; } static f33() { return 33; } static f34() { return 34; } static f35() { return 35; } static f36() { return 36; } static f37() { return 37; } static f38() { return 38; } static f39() { return 39; } static f40() { return 40; } static f41() { return 41; } static f42() { return 42; } static f43() { return 43; } static f44() { return 44; } static f45() { return 45; } static f46() { return 46; } static f47() { return 47; } static f48() { return 48; } static f49() { return 49; } static f50() { return 50; } static f51() { return 51; } static f52() { return 52; } static f53() { return 53; } static f54() { return 54; } static f55() { return 55; } static f56() { return 56; } static f57() { return 57; } static f58() { return 58; } static f59() { return 59; } static f60() { return 60; } static f61() { return 61; } static f62() { return 62; } static f63() { return 63; } static f64() { return 64; } static f65() { return 65; } static f66() { return 66; } static f67() { return 67; } static f68() { return 68; } static f69() { return 69; } static f70() { return 70; } static f71() { return 71; } static f72() { return 72; } static f73() { return 73; } static f74() { return 74; } static f75() { return 75; } static f76() { return 76; } static f77() { return 77; } static f78() { return 78; } static f79() { return 79; } static f80() { return 80; } static f81() { return 81; } static f82() { return 82; } static f83() { return 83; } static f84() { return 84; } static f85() { return 85; } static f86() { return 86; } static f87() { return 87; } static f88() { return 88; } static f89() { return 89; } static a = 1; static length = 1; static b = 2; static read() { return typeof A.length; } }
  try { spyOn(A, "length"); } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(A.read(), A.f3() + A.a + A.b, see(A, "length"));
  console.log(JSON.stringify(out));
}
{
  const out = ["static-field-behind-many-stores length"];
  class A { static a = 1; static { for (let i = 0; i < 120; i++) this["k" + i] = i; } static length = 1; static b = 2; static read() { return typeof A.length; } }
  try { spyOn(A, "length"); } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(A.read(), A.k7 + A.a + A.b, see(A, "length"));
  console.log(JSON.stringify(out));
}
{
  const out = ["static-absent-behind-many-stores length"];
  class A { static a = 1; static { for (let i = 0; i < 120; i++) this["k" + i] = i; } static b = 2; static read() { return typeof A.length; } }
  try { spyOn(A, "length"); } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(A.read(), A.k7 + A.a + A.b, see(A, "length"));
  console.log(JSON.stringify(out));
}
{
  const out = ["static-field-deleted-first length"];
  class A { static a = 1; static length = 1; static b = 2; static read() { return typeof A.length; } }
  delete A[keyOf("length")];
  try { spyOn(A, "length"); } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(A.read(), A.a + A.b, see(A, "length"));
  console.log(JSON.stringify(out));
}
{
  const out = ["static-field-class-expression-in-loop length"];
  const made = [];
  for (let i = 0; i < 3; i++) made.push(class { static a = i; static length = i; static read() { return typeof this.length; } });
  const A = made[1];
  try { spyOn(A, "length"); } catch (e) { out.push("throws " + e.constructor.name); }
  out.push(A.read(), made[0].read(), made[2].read(), A.a, see(A, "length"));
  console.log(JSON.stringify(out));
}
{
  const out = ["static-field-later-than-put length"];
  class A { static a = 1; static { try { spyOn(this, "length"); } catch (e) { out.push("throws " + e.constructor.name); } } static length = 2; static read() { return typeof A.length; } }
  out.push(A.read(), see(A, "length"));
  console.log(JSON.stringify(out));
}
