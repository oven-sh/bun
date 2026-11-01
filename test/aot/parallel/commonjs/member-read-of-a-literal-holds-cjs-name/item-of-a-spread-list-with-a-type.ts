if ([...([1, 0] as number[])][1]) module.exports = 1;
function typeOfThis(this: unknown) {
  return typeof this;
}
console.log("item-of-a-spread-list-with-a-type", typeOfThis());
