// A method's own name is a text.
const key = { constructor() {} }.constructor.name;
function pick(holder, key) {
  return holder[key];
}
console.log(typeof pick(async () => {}, key)("return 7"));
