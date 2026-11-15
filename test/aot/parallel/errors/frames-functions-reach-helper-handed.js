// One helper gives a function object its name. Each function object reaches the helper through an object that text put together at run time has handed back, or out of descriptors that are listed elsewhere. Each frame shows the name of its own function object.
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
function Router(base) {
  this.base = base;
  this.named = () => top(new Error("x").stack) + this.base;
}
const services = [];
const routers = [];
for (let i = 0; i < 8; i++) {
  services.push(new Service(i));
  routers.push(handBack(new Router(i)));
}
const kept = [rename(new Service(10).add, "first"), rename(handBack(new Router(20)).named, "second")];
console.log(
  services[1].add(1, 2),
  "/",
  handBack(services[5]).add(1, 2),
  "/",
  routers[1].named(),
  "/",
  kept[0](1, 2),
  "/",
  kept[1](),
);
rename(services[2].add, "third");
rename(routers[2].named, "fourth");
console.log(services[2].add(1, 2), "/", services[3].add(1, 2), "/", routers[2].named(), "/", routers[3].named());
console.log(kept[0](1, 2), "/", kept[1](), "/", kept.map(made => made.name).join());
delete services[2].add.name;
delete routers[2].named.name;
console.log(services[2].add(1, 2), "/", kept[0](1, 2), "/", routers[2].named(), "/", kept[1]());

class Holder {
  held;
  read = () => this.held;
  constructor(held) {
    this.held = held;
  }
}
const underIndex = name => rename(Object.getOwnPropertyDescriptors([() => top(new Error("x").stack)])[0].value, name);
const listed = Object.entries(Object.getOwnPropertyDescriptors(new Holder(5))).map(
  ([name, each]) => name + typeof each.value + each.writable,
);
const fifth = underIndex("fifth");
const sixth = underIndex("sixth");
console.log(fifth(), "/", sixth(), "/", fifth.call(null), "/", Reflect.apply(sixth, null, []), "/", listed.join());
