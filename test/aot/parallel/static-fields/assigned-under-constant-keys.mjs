// Assignments under keys beside assignments under names.
const key = "m", other = "z", symbol = Symbol("s");
class Pool {}
Pool[key] = n => n + 1;
console.log(Pool.m(2), Object.keys(Pool).join());
class C { static method() { return 1; } }
globalThis.holder = [C];
const K = globalThis.holder[0];
C.a = 1;
console.log(K.method(), K.a, "a" in K);
C[other] = 2;
C.b = 3;
C[symbol] = 4;
C["c" + "d"] = 5;
C["e-f"] = 6;
C[7] = 7;
C.g = 8;
console.log(Object.keys(C).join(), Reflect.ownKeys(C).map(String).join(), C.z, C.cd, C["e-f"], C[7], C[symbol], C.g);
class D { static own = 1; static method() { return this.own; } }
globalThis.holder.push(D);
for (let i = 0; i < 2; i++) {
  console.log(D.method(), globalThis.holder[1].method(), Object.keys(D).join());
  if (!i) D.late = i;
  else D[key] = i;
  D.later = i;
}
console.log(Object.keys(D).join(), JSON.stringify({ ...D }));
