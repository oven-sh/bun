// %o and showHidden of console.dir list the non-enumerable keys of compiled objects, in the order of their creation: of a literal, of an instance and of what lies in them. No getter runs.
class Point {
  x = 1;
  method() {}
  get accessor() {
    return 1;
  }
}
let calls = 0;
const literal = { shown: 1 };
Object.defineProperty(literal, "hidden", { value: 2, enumerable: false });
Object.defineProperty(literal, "computed", { get: () => ++calls, enumerable: false });
literal.later = 3;
const instance = new Point();
Object.defineProperty(instance, "hidden", { value: { deep: literal }, enumerable: false });
console.log("%o", literal);
console.dir(literal, { showHidden: true });
console.log("%O", literal);
console.log(literal);
console.dir(literal);
console.log("%o", instance);
console.dir(instance, { showHidden: true, depth: 4 });
console.log(instance, calls);
