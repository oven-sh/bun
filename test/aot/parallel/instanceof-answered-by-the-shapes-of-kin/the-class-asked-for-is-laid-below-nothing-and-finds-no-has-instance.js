// Out of sight the class asked for is laid below null: it finds no Symbol.hasInstance at all, and the language then walks the chain as ever. Later it is laid below a plain function, then below a proxy.
// STATISTIC: MissesOfInstanceOfAnsweredByShapesOfKin >= 2
class Animal { constructor(n) { this.n = n; } }
class Dog extends Animal { bark() { return 1; } }
class Cat extends Animal { purr() { return 2; } }
const named = text => JSON.parse('"' + text + '"');
const lay = Object[named("setPrototypeOf")];
const things = JSON.parse("[0,1,2,0,1]").map((kind, n) => new [Dog, Cat, Animal][kind](n));
function dogs() { let sum = 0; for (let i = 0; i < things.length; i++) if (things[i] instanceof Dog) sum++; return sum; }
const said = [];
let asked = 0;
for (let turn = 0; turn < 200; turn++) {
  if (turn === 50) lay(Dog, null);
  if (turn === 100) lay(Dog, function () {});
  if (turn === 150) lay(Dog, new Proxy(function () {}, { get(target, key, receiver) { asked++; return Reflect.get(target, key, receiver); } }));
  const answer = dogs();
  if (said[said.length - 1] !== answer) said.push(turn, answer);
}
console.log(said.join(), asked);
