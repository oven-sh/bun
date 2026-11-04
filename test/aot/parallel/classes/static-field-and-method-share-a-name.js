// A static field and a static method of one name: which of them the keys of the class show.
class Base {
  static m;
  static m() {}
}
const r = [];
for (const key in Base)
  r.push(key);
console.log(r.join(), Object.keys(Base).join(), Object.getOwnPropertyDescriptor(Base, "m").enumerable);
