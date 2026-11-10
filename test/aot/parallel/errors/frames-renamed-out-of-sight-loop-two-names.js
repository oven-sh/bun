// Function objects of one arrow function are called in a loop within a loop: behind the naming of one that is not among them, and again behind the naming of one that is. One of their holders has been seen by text put together at run time. Each frame shows the name of its own function object.
const rename = (made, name) => Object.defineProperty(made, "name", { value: name });
const handBack = new Function("x", ["return", "x"].join(" "));
class Service {
  constructor(base) {
    this.base = base;
    this.add = (a, b) => new Error("x").stack.split("\n")[1].trim().split(" ")[1] + (this.base + a + b);
  }
}
const services = [];
for (let i = 0; i < 8; i++) services.push(new Service(i));
handBack(services[5]);
const kept = rename(new Service(10).add, "first");
function count(list) {
  const seen = {};
  for (let round = 0; round < 50; round++) {
    for (let i = 0; i < list.length; i++) {
      const text = list[i].add(1, 2);
      seen[text] = (seen[text] ?? 0) + 1;
    }
  }
  return seen;
}
console.log(JSON.stringify(count(services)), kept(1, 2));
rename(services[2].add, "third");
console.log(JSON.stringify(count(services)), kept(1, 2));
