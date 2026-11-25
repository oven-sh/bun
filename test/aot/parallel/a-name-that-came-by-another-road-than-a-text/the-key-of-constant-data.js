// The name comes out of the keys of a record of constants, and a function is asked under it: what is found evaluates a text.
const key = Object.entries({ constructor: 1 })[JSON.parse("0")][0];
function pick(holder, key) {
  return holder[key];
}
console.log(pick(function () {}, key)("return 7")());
