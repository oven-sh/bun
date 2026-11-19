const crate = { undefined: "under the word", *[Symbol.iterator]() { yield 1; } };
function early() {
  return typeof crate[late];
}
function hoisted() {
  return crate[filledLater];
}
try {
  console.log(early());
} catch (error) {
  console.log(error.constructor.name);
}
console.log(hoisted());
const late = Symbol.iterator;
var filledLater = Symbol.iterator;
console.log(early(), typeof hoisted());
