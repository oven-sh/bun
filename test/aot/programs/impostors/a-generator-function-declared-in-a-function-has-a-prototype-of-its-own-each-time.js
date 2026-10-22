function same(a, b) {
  return a === b;
}
function make() {
  function* numbers() {}
  const made = numbers();
  console.log(same(made.__proto__, numbers.prototype));
  return made;
}
const first = make();
const second = make();
console.log(same(first.__proto__ !== second.__proto__, true));
