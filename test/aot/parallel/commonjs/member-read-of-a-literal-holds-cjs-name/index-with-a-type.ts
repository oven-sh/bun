if ([1, 0][1 as number]) module.exports = 1;
function typeOfThis(this: unknown) {
  return typeof this;
}
console.log("index-with-a-type", typeOfThis());
