"use strict";
const K = JSON.parse('["argv","extra"]'), said = [];
function lengthOf() { let s = 0; for (let i = 0; i < 5; i++) { const list = process.argv; s += list === undefined ? -1 : typeof list === "object" ? list.length : 100; } return s; }
const real = process.argv, more = real.length > 99 ? ["never"] : [];
said.push(lengthOf() === real.length * 5);
process[K[0]] = ["a", "b", "c", ...more]; said.push(lengthOf());
process[K[0]] = ["d", ...more]; said.push(lengthOf());
Object.defineProperty(process, K[0], { value: ["g", ...more], writable: true, configurable: true, enumerable: true });
said.push(lengthOf());
process[K[0]] = ["y", "z", ...more]; said.push(lengthOf());
console.log(said.join(" "));
