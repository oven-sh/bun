// `Below.prototype.x = 0` is stored at some time. Until then a store through an object below goes on to the setter above; from then on it creates a property of the object.
const log = [];
function show(o) { return `${typeof o.x}:${Object.hasOwn(o, "x")}`; }
class Above { set x(v) { log.push("setter " + v); } get x() { return "got"; } }
class Below extends Above {}
function store(o, v) { o.x = v; return show(o); }
function Old() {}
Old.prototype = Object.create(Above.prototype);

console.log(store(new Below(), 1), store(new Old(), 2), log.splice(0).join());
function give() {
  Object.defineProperty(Below.prototype, "x", { value: 0, writable: true, configurable: true, enumerable: true });
  Object.defineProperty(Old.prototype, "x", { value: 0, writable: true, configurable: true, enumerable: true });
}
for (let i = 0; i < 3; i++) console.log(store(new Below(), i), store(new Old(), i), log.splice(0).join());
give();
for (let i = 0; i < 3; i++) console.log(store(new Below(), i), store(new Old(), i), log.splice(0).join());

// The plain store of a default on a prototype whose chain has no setter, then a class between gets one.
class Top {}
class Middle extends Top {}
class Bottom extends Middle {}
function put(o, v) { o.y = v; return `${typeof o.y}:${Object.hasOwn(o, "y")}`; }
console.log(put(new Bottom(), 1), log.splice(0).join());
Bottom.prototype.y = "default";
console.log(put(new Bottom(), 2), new Bottom().y, log.splice(0).join());
Object.defineProperty(Top.prototype, "y", { set(v) { log.push("top setter " + v); }, configurable: true });
console.log(put(new Bottom(), 3), put(new Middle(), 4), log.splice(0).join());
delete Bottom.prototype.y;
console.log(put(new Bottom(), 5), log.splice(0).join());
