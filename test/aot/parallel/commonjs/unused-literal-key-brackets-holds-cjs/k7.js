// prettier-ignore
({ [-1]: module });
function typeOfThis() {
  return typeof this;
}
console.log("[-1]", typeOfThis());
