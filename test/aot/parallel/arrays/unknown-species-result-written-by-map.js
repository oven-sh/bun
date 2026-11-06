// The species constructor reaches the list through flatMap, so the compiler cannot tell which function it is. The built-in writes `length` into the object it returns.
function passThrough(value) {
  return [value].flatMap(element => [element])[0];
}
class C {}
const made = new C();
made.length = 1.5;
const list = [3, 1, 2];
function give() {
  return made;
}
list.constructor = passThrough({ [Symbol.species]: give });
list.map(element => element * 2);
console.log(typeof made.length, made.length * 2, made[0], made[2], Object.keys(made).join());
