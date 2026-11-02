// An object that holds a function object is handed to text put together at run time, which does nothing with it. A helper names two other function objects of the same arrow function, one behind the frames that are printed. The frame of one that was left alone shows no name.
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
handBack(services[5]);
console.log(services[1].add(1, 2), "/", kept[0](1, 2));
rename(services[2].add, "third");
