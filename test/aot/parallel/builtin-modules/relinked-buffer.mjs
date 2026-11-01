import m from "node:buffer";
const M = JSON.parse('0', () => m); Object.setPrototypeOf(M, Array.prototype);
const ask = () => m instanceof Array;
console.log(String(ask()));
