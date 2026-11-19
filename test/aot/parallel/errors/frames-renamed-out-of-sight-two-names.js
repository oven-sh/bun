// Function objects of one arrow function lie in fields of objects, one of which text put together at run time has seen. A helper names two of them, at two times. Each frame shows the name of its own function object.
const top = stack =>
  String(stack)
    .split("\n")
    .filter(line => line.trimStart().startsWith("at "))
    .slice(0, 1)
    .map(line => line.trim().replace(/ ?\(?[^ (]*:\d+:\d+\)?$/, ""))
    .join();
const rename = (made, name) => Object.defineProperty(made, "name", { value: name });
const handBack = new Function("x", ["return", "x"].join(" "));
class Service {
  constructor(base) {
    this.base = base;
    this.add = (a, b) => top(new Error("x").stack) + (this.base + a + b);
  }
}
const services = [];
for (let i = 0; i < 8; i++) services.push(new Service(i));
const kept = [rename(new Service(10).add, "first")];
console.log(services[1].add(1, 2), "/", handBack(services[5]).add(1, 2), "/", kept[0](1, 2));
rename(services[2].add, "third");
console.log(services[2].add(1, 2), "/", services[3].add(1, 2), "/", kept[0](1, 2));
