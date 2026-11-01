let text: string = "ab";
if (text.length === 3) module.exports = 1;
function typeOfThis(this: unknown) {
  return typeof this;
}
console.log("length-of-a-variable-with-a-type", typeOfThis());
