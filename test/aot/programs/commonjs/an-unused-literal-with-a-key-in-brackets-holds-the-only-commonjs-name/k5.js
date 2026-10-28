// prettier-ignore
({ [0]: module });
function typeOfThis() {
  return typeof this;
}
console.log("[0]", typeOfThis());
