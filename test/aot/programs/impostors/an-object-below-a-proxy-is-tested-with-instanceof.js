class Foo {}
let calls = 0;
const proxy = new Proxy({}, {
  getPrototypeOf() {
    calls++;
    return Foo.prototype;
  },
});
const below = Object.create(proxy);
console.log(below instanceof Foo, calls);
console.log(proxy instanceof Foo, calls);
const list = JSON.parse("[0]");
list[0] = below;
console.log(list[0] instanceof Foo, calls);
