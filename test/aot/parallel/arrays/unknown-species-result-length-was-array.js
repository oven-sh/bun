// The species constructor reaches the list through flatMap, so the compiler cannot tell which function it is. The built-in writes `length` into the object it returns.
function passThrough(value) {
  return [value].flatMap(element => [element])[0];
}
class C {}
const made = new C();
made.length = [1];
const list = [3, 1, 2];
function give() {
  return made;
}
list.constructor = passThrough({ [Symbol.species]: give });
list.slice();
console.log(typeof made.length, made.length[0], made.length.length, Array.isArray(made.length));
