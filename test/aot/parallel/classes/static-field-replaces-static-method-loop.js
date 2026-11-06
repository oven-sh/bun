// A static block stores to the name of a static method in a loop, and then a static field of that name is defined.
class Base {
  static m() {}
  static {
    for (let i = 0; i < 3; i++) this.m = i;
    console.log(Object.keys(this).join(), this.m, Object.getOwnPropertyDescriptor(this, "m").enumerable);
  }
  static m = 1;
}
const names = [];
for (const key in Base) names.push(key);
console.log(names.join(), Object.keys(Base).join(), Base.m, Object.getOwnPropertyDescriptor(Base, "m").enumerable);
