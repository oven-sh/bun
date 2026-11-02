// prettier-ignore
({ ["a"]: function () { return module; } });
function typeOfThis() {
  return typeof this;
}
console.log('["a"]: function () { return module; }', typeOfThis());
