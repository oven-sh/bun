class Foo {}
function Bar() {}
let calls = 0;
Bar.prototype = new Proxy({}, {
  getPrototypeOf() {
    calls++;
    return Foo.prototype;
  },
});
const bar = new Bar();
console.log(bar instanceof Foo, calls);
