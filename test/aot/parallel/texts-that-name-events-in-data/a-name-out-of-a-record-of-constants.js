const words = { first: "constructor", second: ["length"] };
function pick(holder, at) { return holder[words[at]]; }
const make = pick(function () {}, JSON.parse('"first"'));
console.log(make("return 8")());
