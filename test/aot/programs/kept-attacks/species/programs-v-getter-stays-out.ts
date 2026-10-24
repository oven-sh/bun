// No native reader meets an instance: the program prints the same, and the getter need not be compiled.
class Quiet extends Array<number> { static get [Symbol.species](): any { console.log("never"); return Array; } }
const quiet = new Quiet(); quiet.push(1, 2);
console.log(quiet.length, quiet[1], quiet.indexOf(2));
