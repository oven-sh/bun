function Bar() {}
function make() {
  return new Bar();
}
console.log(Object.getPrototypeOf(make()) === Bar.prototype, make().x);
const parent = { x: 1 };
Bar.prototype = parent;
console.log(Object.getPrototypeOf(make()) === parent, make().x);
Bar.prototype = new Proxy({}, { get() { return 7; } });
console.log(make().x);
