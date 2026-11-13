"use strict";
const K = JSON.parse('["argv","extra"]'), said = [];
function lengthOf() { let s = 0; for (let i = 0; i < 5; i++) { const list = process.argv; s += list === undefined ? -1 : typeof list === "object" ? list.length : 100; } return s; }
const real = process.argv, more = real.length > 99 ? ["never"] : [];
said.push(lengthOf() === real.length * 5);
process[K[0]] = ["a", "b", "c", ...more]; said.push(lengthOf());
process[K[0]] = ["d", ...more]; said.push(lengthOf());
let reads = 0;
Object.defineProperty(process, K[0], { get() { reads++; return ["h", "i", ...more]; }, set(value) { said.push("set " + value.length); }, configurable: true });
said.push(lengthOf(), reads);
said.push(lengthOf());
process[K[0]] = ["y", "z", ...more]; said.push(lengthOf());
console.log(said.join(" "));
