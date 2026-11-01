// The mapper is callable and is no function of the program: a proxy of one, one out of another realm, a bound one, a built-in.
console.log(JSON.stringify(Array.from({ length: 2 }, new Proxy((value, index) => index, {}))));
console.log(JSON.stringify(Array.from({ length: 2 }, require("node:vm").runInNewContext("(value, index) => index + 1"))));
console.log(JSON.stringify(Array.from({ length: 2 }, ((base, value, index) => base + index).bind(null, 10))));
console.log(JSON.stringify(Array.from({ length: 2 }, Math.abs)));
function make(mapper) {
  return Array.from({ length: 2 }, mapper);
}
console.log(JSON.stringify(make(new Proxy((value, index) => index, {}))), JSON.stringify(make((value, index) => index * 2)), JSON.stringify(make()));
