// `x instanceof Shape` walks up the chain of x. A proxy that comes from outside stands in that chain, and its getPrototypeOf trap stores into a variable that the caller reads on both sides of the test
// Under: --aot-testing=CheckProofsAtRunTime: LinkedFunction::effectsOnReturn of isShape(): no code runs in a walk up the chain of an object of the program
class Shape { constructor() { this.sides = 4; } }
let walks = 0;
function isShape(x) { return x instanceof Shape; }
function deed(x) {
    const before = walks;
    const answer = isShape(x);
    return String(answer) + " " + String(walks - before);
}
console.log(deed(new Shape()));
let log = "";
for (let turn = 0; turn < 300; turn++) log = deed(new Shape());
console.log(log);
const handler = { getPrototypeOf(target) { walks++; return Shape.prototype; } };
const made = [new Proxy({}, handler), Object.create(new Proxy({}, handler))];
const outside = JSON.parse("[0, 1]");
for (let i = 0; i < outside.length; i++) console.log(deed(made[outside[i]]));
console.log(deed(new Shape()), String(walks));
