function texts(parts) { return parts; }
const words = texts`constructor${0}length`;
function pick(holder, at) { return holder[words[at]]; }
const make = pick(function () {}, JSON.parse("0"));
console.log(make("return 9")());
