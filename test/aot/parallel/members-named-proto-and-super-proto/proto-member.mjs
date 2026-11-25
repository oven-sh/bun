class Tagged {
  __proto__() { return 1; }
  hello() { return 2; }
}
class Base { static make() { return 3; } }
class Below extends Base { static __proto__() { return 4; } }
function helloOf(o) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return o.__proto__.hello;
}
function makeOf(c) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return c.__proto__.make;
}
const tagged = new Tagged();
const first = helloOf(tagged);
const second = makeOf(Below);
console.log(typeof first, first === undefined, typeof second, second === undefined);
