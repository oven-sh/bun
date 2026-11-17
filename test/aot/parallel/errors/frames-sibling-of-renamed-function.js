// One function object of several is given a name, with the only text that the program ever gives to that function. Each frame shows the name of its own function object.
const top = stack => stack.split("\n")[1].trim().split(" ")[1];

const make = () => () => top(new Error("x").stack);
const one = make();
const two = make();
Object.defineProperty(one, "name", { value: "first" });
console.log(one(), two());

class Service {
  constructor(base) {
    this.base = base;
    this.add = a => top(new Error("x").stack) + (this.base + a);
  }
}
const services = [];
for (let i = 0; i < 4; i++) services.push(new Service(i));
const kept = Object.defineProperty(new Service(10).add, "name", { value: "second" });
console.log(services.map(service => service.add(1)).join(), kept(1));

function outer(i) {
  function inner() {
    return top(new Error("x").stack) + i;
  }
  return i === 2 ? Object.defineProperty(inner, "name", { value: "third" }) : inner;
}
const inners = [];
for (let i = 0; i < 4; i++) inners.push(outer(i));
let seen = "";
for (let round = 0; round < 3; round++) for (const inner of inners) seen += inner() + " ";
console.log(seen);

const once = () => top(new Error("x").stack);
console.log(once());
Object.defineProperty(once, "name", { value: "fourth" });
console.log(once());
