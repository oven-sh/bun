const words = ["constructor", "length"];
function pick(holder, at) { return holder[words[at]]; }
const make = pick(function () {}, JSON.parse("0"));
console.log(make("return 7")());
