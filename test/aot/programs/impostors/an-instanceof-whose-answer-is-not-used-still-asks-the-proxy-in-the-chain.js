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
bar instanceof Foo;
console.log(calls);
