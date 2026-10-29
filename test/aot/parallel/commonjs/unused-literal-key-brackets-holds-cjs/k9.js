// prettier-ignore
({ [null]: module });
function typeOfThis() {
  return typeof this;
}
console.log("[null]", typeOfThis());
