class A { static count = 1; static names = ["a"]; static m() { return "A.m"; } static get g() { return this === P ? "getter for proxy" : "getter"; } }
A.later = 2;
const P = new Proxy(A, { get(target, key, receiver) { return Reflect.get(target, key, receiver); } });
console.log(P.count, P.names.join(), P.m(), P.g, P.later, P.name, P.length, typeof P.prototype);
console.log(Reflect.get(A, "count", P), Reflect.get(A, "count", {}), Reflect.get(A, "later", {}), Reflect.get(A, "count"), Reflect.get(A, "name", {}));
const Q = new Proxy(A, {});
console.log(Q.count, Q.names.join(), Q.m(), Q.later);
const heir = Object.create(A);
console.log(heir.count, heir.later, heir.names.join());
