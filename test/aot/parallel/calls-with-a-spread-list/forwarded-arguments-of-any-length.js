class Rest { constructor(...all) { this.n = all.length; this.last = all[all.length - 1]; } }
class Counted { constructor() { this.n = arguments.length; this.last = arguments[arguments.length - 1]; } }
class Named { constructor(a, b = "b") { this.n = a; this.last = b; } }
class NewTarget { constructor(...all) { this.n = new.target.name; this.last = all.length; } }
class FromArray extends Array { }
const bases = [Rest, Counted, Named, NewTarget, FromArray];
const made = [];
for (const Base of bases) {
  class A extends Base {}
  class B extends A {}
  class C extends B { field = this.n; }
  class D extends C {}
  made.push(A, B, C, D);
}
class E1 extends Rest {} class E2 extends E1 {} class E3 extends E2 {}
class F1 extends Counted {} class F2 extends F1 {}
class G1 extends Named {} class G2 extends G1 {}
const known = list => [new E3(...list), new F2(...list), new G2(...list), Reflect.construct(E3, list), Reflect.construct(F2, list, E1), new E3(), new E3(1, 2), new F2(1), new G2(5)];
const show = it => `${it.constructor.name}:${it.n}:${it.last}:${it.field}:${it.length}`;
for (const n of [0, 1, 3, 65535, 65536, 70000]) {
  const list = Array.from({ length: n }, (_, i) => i);
  for (const it of known(list)) console.log(n, show(it));
  for (const Made of made) {
    let said;
    try { said = show(Reflect.construct(Made, list)); } catch (error) { said = error.name; }
    let other;
    try { other = show(new Made(...list)); } catch (error) { other = error.name; }
    console.log(n, Made.name, said, other);
  }
}
