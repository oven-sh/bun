// prettier-ignore
({ ["a"]() { return module; } });
function typeOfThis() {
  return typeof this;
}
console.log('["a"]() { return module; }', typeOfThis());
