// prettier-ignore
({ [1n]: module });
function typeOfThis() {
  return typeof this;
}
console.log("[1n]", typeOfThis());
