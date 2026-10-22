function same(actual, expected) {
  return actual === expected;
}
function* numbers() {}
const original = numbers.prototype;
console.log(same(numbers().__proto__, numbers.prototype));
numbers.prototype = {};
const made = numbers();
console.log(same(made.__proto__, numbers.prototype), same(made.__proto__ !== original, true));
