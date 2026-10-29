// One place in evaluated text reads a name of many classes. Most find it above themselves. The last has a static member of that name.
const say = (...values) => console.log(...values);
const evaluated = (parameters, body) => new Function(parameters, body + (process.env.NOBODY_HAS_SET_THIS ?? ""));
function lastOf(read, others, last) {
  for (let turn = 0; turn < 12; turn++) read(others[turn % others.length]);
  return read(last);
}

class A1 {} class B1 {} class C1 {} class Own1 { static toString() { return "own toString"; } }
say(lastOf(evaluated("c", "return c.toString()"), [A1, B1, C1], Own1));
class A2 {} class B2 {} class C2 {} class Own2 { static valueOf() { return "own valueOf"; } }
say(lastOf(evaluated("c", "const { valueOf } = c; return valueOf === Object.prototype.valueOf"), [A2, B2, C2], Own2));
class A3 {} class B3 {} class C3 {} class Own3 { static call = 5; static apply = 6; }
say(lastOf(evaluated("c", "return typeof c.call"), [A3, B3, C3], Own3), lastOf(evaluated("c", "return typeof c.apply"), [A3, B3, C3], Own3));
class A4 {} class B4 {} class C4 {} class Own4 { static bind() { return "own bind"; } }
say(lastOf(evaluated("c", "return typeof c.bind()"), [A4, B4, C4], Own4));
class A5 {} class B5 {} class C5 {} class Own5 { static constructor() {} }
say(lastOf(evaluated("c", "return c.constructor === Function"), [A5, B5, C5], Own5));
class A6 {} class B6 {} class C6 {} class Own6 { static hasOwnProperty() { return "own hasOwnProperty"; } }
say(lastOf(evaluated("c", "return c.hasOwnProperty('x')"), [A6, B6, C6], Own6));
class A7 {} class B7 {} class C7 {} class Own7 { static [Symbol.hasInstance]() { return true; } }
say(lastOf(evaluated("c", "return 1 instanceof c"), [A7, B7, C7], Own7));
class A8 {} class B8 {} class C8 {} class Own8 { static isPrototypeOf = "a field"; }
say(lastOf(evaluated("c", "return typeof c?.isPrototypeOf"), [A8, B8, C8], Own8));

class Maker { static make() { return "Maker's"; } static get got() { return "Maker's got"; } static kept = "Maker's kept"; }
class M1 extends Maker {} class M2 extends Maker {} class M3 extends Maker {}
class Overrides extends Maker { static make() { return "Overrides'"; } }
class CallsSuper extends Maker { static make() { return "CallsSuper's and " + super.make(); } }
class OwnGetter extends Maker { static get got() { return "OwnGetter's got"; } }
class OwnField extends Maker { static kept = "OwnField's kept"; }
say(lastOf(evaluated("c", "return c.make()"), [M1, M2, M3], Overrides));
say(lastOf(evaluated("c", "return c.make()"), [M1, M2, M3], CallsSuper));
say(lastOf(evaluated("c", "return c.got"), [M1, M2, M3], OwnGetter));
say(lastOf(evaluated("c", "return c.kept"), [M1, M2, M3], OwnField));

class Grows {} class G1 extends Grows {} class G2 extends Grows {} class G3 extends Grows {}
class HasLate extends Grows { static late = "HasLate's"; }
Grows.late = "Grows'";
say(lastOf(evaluated("c", "return c.late"), [G1, G2, G3], HasLate));

class Top { static deep() { return "Top's"; } } class Middle extends Top {}
class D1 extends Middle {} class D2 extends Middle {} class D3 extends Middle {}
class DeepOwn extends Middle { static deep() { return "DeepOwn's"; } }
say(lastOf(evaluated("c", "return c.deep()"), [D1, D2, D3], DeepOwn), lastOf(evaluated("c", "return c.deep()"), [D1, DeepOwn, D2], Middle));
