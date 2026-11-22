// Names that functions hold themselves, read while the class is being defined and declared as static fields behind that.
const seen = [];
class C {
  static m() { return "m"; }
  static { seen.push(this.m(), this.name, this.length, typeof this.prototype, Object.hasOwn(this, "name"), this.never); }
  static name = "declared";
  static { seen.push(this.name, Reflect.ownKeys(this).join()); }
  static length = 7;
  static { seen.push(this.length, C.name, C.m()); }
  static later = C.name + C.length;
}
console.log(seen.map(String).join(" "));
console.log(C.name, C.length, C.later, Reflect.ownKeys(C).join(), Object.keys(C).join());
globalThis.holder = [C];
const K = globalThis.holder[0];
for (let i = 0; i < 3; i++) console.log(K.name, K.length, K.later, C.name, C.length, C.m());
C.name = "again";
K.length = 8;
console.log(C.name, K.name, C.length, K.length, delete K.name, C.name, K.name, Object.hasOwn(C, "name"));
