import m from "node:util/types";
const M = JSON.parse('0', () => m); M.__proto__ = Array.prototype;
const ask = () => m instanceof Array;
console.log(String(ask()));
