// prettier-ignore
({ [true]: module });
function typeOfThis() {
  return typeof this;
}
console.log("[true]", typeOfThis());
