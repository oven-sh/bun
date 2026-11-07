import { E, bump } from "./other.js";
console.log(E.x, bump(), E.x, Object.keys(E));
E.y = 2;
console.log(E.y, Object.keys(E));
function Self() {}
Self.a = 1;
function* g() { yield Self.a; Self.a = 2; yield Self.a; }
console.log([...g()], Self.a);
(async () => { await null; Self.a = 3; console.log(Self.a); })();
for (let i = 0; i < 2; i++) { function Inner() {} Inner.q = i; console.log(Inner.q, Object.keys(Inner)); }
function Re() {}
Re.a = 1;
Re = function () {};
console.log(Re.a);
