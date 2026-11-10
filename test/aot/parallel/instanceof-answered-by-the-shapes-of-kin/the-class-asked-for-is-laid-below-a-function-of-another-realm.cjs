// Out of sight the class asked for is laid below a function of another realm: the Symbol.hasInstance that it finds is that realm's own, which does what this realm's does.
// STATISTIC: MissesOfInstanceOfAnsweredByShapesOfKin >= 2
const vm = require("node:vm");
class Animal { constructor(n) { this.n = n; } }
class Dog extends Animal { bark() { return 1; } }
class Cat extends Animal { purr() { return 2; } }
const named = text => JSON.parse('"' + text + '"');
const lay = Object[named("setPrototypeOf")];
const foreign = vm.runInNewContext("(function () {})");
const things = JSON.parse("[0,1,2,0,1]").map((kind, n) => new [Dog, Cat, Animal][kind](n));
function dogs() { let sum = 0; for (let i = 0; i < things.length; i++) if (things[i] instanceof Dog) sum++; return sum; }
const said = [];
for (let turn = 0; turn < 120; turn++) {
  if (turn === 60) lay(Dog, foreign);
  const answer = dogs();
  if (said[said.length - 1] !== answer) said.push(turn, answer);
}
console.log(said.join(), Dog[Symbol.hasInstance] === Function.prototype[Symbol.hasInstance]);
