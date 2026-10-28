// With declared functions: What a program can ask of a class object: its name, its text, Symbol.hasInstance, Symbol.species, toStringTag, own keys and their order.
const lines = [];
const attempt = (run) => { try { return String(run()); } catch (error) { return error.constructor.name; } };
class Base { }
class Other { }
function Plain(Parent) { return class extends Parent { }; }
function Inner(Parent) { return class Named extends Parent { static self() { return Named; } me() { return Named.name + (this instanceof Named); } static rename() { try { Named = 1; } catch (error) { return error.constructor.name; } } }; }
function OwnName(Parent) { return class extends Parent { static name = "given"; }; }
function NameMethod(Parent) { return class extends Parent { static name() { return "called"; } }; }
function Judge(Parent, verdict) { return class extends Parent { static [Symbol.hasInstance](o) { return verdict(o, this); } }; }
function Species(Parent) { return class extends Parent { static get [Symbol.species]() { return Array; } get [Symbol.toStringTag]() { return "Tagged"; } }; }
const P1 = Plain(Base), P2 = Plain(Base), P3 = Plain(Other);
const I1 = Inner(Base), I2 = Inner(Other);
const O1 = OwnName(Base), O2 = OwnName(Base);
const M1 = NameMethod(Base), M2 = NameMethod(Other);
const J1 = Judge(Base, (o) => o === 1), J2 = Judge(Base, (o, C) => C === J2 && o === 2);
const L1 = Species(Array), L2 = Species(Array);
lines.push([P1, P2, P3, I1, I2, O1, O2].map((C) => JSON.stringify(C.name) + JSON.stringify(Object.getOwnPropertyNames(C))).join(" "));
lines.push([M1.name(), M2.name(), typeof M1.name, M1.name === M2.name].join());
lines.push([I1.self() === I1, I2.self() === I2, I1.self() === I2, new I1().me(), new I2().me(), I1.rename(), I2.rename(), I1.prototype.me.call(new I2())].join());
O1.name2 = 1; lines.push([Object.getOwnPropertyDescriptor(O1, "name").writable, Object.getOwnPropertyDescriptor(P1, "name") === undefined, JSON.stringify(Object.getOwnPropertyDescriptor(I1, "name"))].join());
lines.push([1 instanceof J1, 2 instanceof J1, 1 instanceof J2, 2 instanceof J2, new J1() instanceof J1, new J2() instanceof Base, J1[Symbol.hasInstance] === J2[Symbol.hasInstance]].join());
lines.push([new L1(1, 2, 3).map((x) => x).constructor === Array, Object.prototype.toString.call(new L2()), L1.from([1]).constructor === L1, L2.of(1) instanceof L1].join());
lines.push([P1.toString().replace(/\s+/g, ""), I1.toString() === I2.toString(), P1.toString() === P3.toString(), Function.prototype.toString.call(I1.prototype.me) === Function.prototype.toString.call(I2.prototype.me)].join("|"));
lines.push([I1.prototype.me === I2.prototype.me, I1.self === I2.self, I1.prototype.me.name, I1.self.name, Object.getOwnPropertyNames(I1.prototype).join("/")].join());
const asKeys = new Map([[P1, "p1"], [P2, "p2"], [P3, "p3"]]); const weak = new WeakSet([I1]);
lines.push([asKeys.get(P1), asKeys.get(P2), asKeys.get(P3), asKeys.size, weak.has(I1), weak.has(I2)].join());
Object.defineProperty(P1, "name", { value: "renamed" }); lines.push([P1.name, JSON.stringify(P2.name)].join());
lines.push(attempt(() => P1()), attempt(() => Reflect.construct(P1, [], P2) instanceof P2), attempt(() => Reflect.construct(P1, [], P2) instanceof P1), attempt(() => Reflect.construct(I1, [], I2).me()), attempt(() => Reflect.construct(Base, [], P3) instanceof Other));
console.log(lines.join("\n"));
