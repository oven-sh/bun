// prettier-ignore
({ get ["a"]() { return module; } });
function typeOfThis() {
  return typeof this;
}
console.log('get ["a"]() { return module; }', typeOfThis());
