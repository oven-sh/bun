// The species constructor reaches the list through flatMap, so the compiler cannot tell which function it is. The built-in writes `length` into the object it returns.
function passThrough(value) {
  return [value].flatMap(element => [element])[0];
}
class C {}
const made = new C();
made.length = null;
const list = [3, 1, 2];
function give() {
  return made;
}
list.constructor = passThrough({ [Symbol.species]: give });
list.slice();
console.log(made.length === null, made.length ?? "nothing", typeof made.length);
