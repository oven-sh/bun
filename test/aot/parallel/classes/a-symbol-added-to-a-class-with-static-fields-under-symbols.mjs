// Symbols of a class are listed in the order in which they came.
class C { static [Symbol.for('a')] = 1 } C[Symbol.for('b')] = 2; console.log(Object.getOwnPropertySymbols(C).map(String).join(), Reflect.ownKeys(C).length);
class D { static [Symbol.for('a')] = 1; static [Symbol.for('c')] = 3 } D[Symbol.for('b')] = 2; console.log(Object.getOwnPropertySymbols(D).map(String).join());
class E { static [Symbol.for('a')] = 1; static s = 5; static [Symbol.for('c')] = 3 } E[Symbol.for('b')] = 2; console.log(Reflect.ownKeys(E).map(String).join());
const k = Symbol('k'); class F { static [k] = 1 } F[Symbol.for('b')] = 2; F.z = 3; console.log(Reflect.ownKeys(F).map(String).join());
class G { static [Symbol.for('a')]() {} static x = 1 } G[Symbol.for('b')] = 2; console.log(Reflect.ownKeys(G).map(String).join());
