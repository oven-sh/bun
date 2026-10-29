// A constructor stores arrow functions that capture `this` to `this`. Some of the function objects get a name of their own. Others are called before anything has read them, by code that runs once, and a full collection runs inside the call; each frame shows the name of its function object.
// Flags: --aot-disable=flow-results
function nameInFrame() {
  return new Error("x").stack.split("\n")[2].trim().split(" ")[1];
}
function Router(base) {
  this.base = base;
  this.collect = () => {
    Bun.gc(true);
    return this.base;
  };
  this.named = () => {
    Bun.gc(true);
    return nameInFrame() + this.base;
  };
}
class Service {
  constructor(base) {
    this.base = base;
    this.add = (a, b) => {
      Bun.gc(true);
      return this.base + a + b;
    };
    this.wait = async () => {
      Bun.gc(true);
      return this.base;
    };
  }
}
function rename(made, name) {
  return Object.defineProperty(made, "name", { value: name });
}
// Text that is put together at run time hands an object back: nobody knows what it is.
const handBack = new Function("x", ["return", "x"].join(" "));
const kept = [
  rename(new Router(1).collect, "first"),
  rename(new Router(2).named, "second"),
  rename(new Service(3).add, "third"),
  rename(new Service(4).wait, "fourth"),
];
const routers = [];
const services = [];
for (let i = 0; i < 60; i++) {
  routers.push(new Router(i));
  services.push(new Service(i));
}
console.log(routers[7].collect(), routers[8].named(), services[9].add(1, 2), await services[10].wait());
console.log(handBack(routers[17]).collect(), handBack(routers[18]).named(), handBack(services[19]).add(1, 2), await handBack(services[20]).wait());
rename(routers[11].named, "late");
rename(services[12].add, "later");
console.log(routers[11].named(), routers[13].named(), services[12].add(1, 2), services[14].add(1, 2));
console.log(kept.map(made => made.name).join(), kept[0](), kept[1](), kept[2](1, 2), await kept[3]());
