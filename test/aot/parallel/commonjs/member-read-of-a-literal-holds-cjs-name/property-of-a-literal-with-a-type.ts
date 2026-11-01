if (({ b: 0 } as any).b) module.exports = 1;
function typeOfThis(this: unknown) {
  return typeof this;
}
console.log("property-of-a-literal-with-a-type", typeOfThis());
