// The engine's own functions store elements on compiled objects: push, fill and copyWithin called on an object with a length, Object.assign from a list.
// Each such store goes by the short way of elements, as a store that compiled code makes, and not through descriptors.
// COUNT: counter:ElementsStoredByDescriptors <= 40
class Stack { constructor() { this.length = 0; } push(x) { return Array.prototype.push.call(this, x); } }
const bag = { length: 0 };
let sum = 0;
for (let t = 0; t < 400; t++) {
  const stack = new Stack();
  for (let i = 0; i < 8; i++) { stack.push(i + t); Array.prototype.push.call(bag, i); if (bag.length > 15) bag.length = 0; }
  sum += stack.length + stack[3] + bag.length + Object.assign(new Stack(), [t, 2, 3])[0] + Array.prototype.fill.call({ length: 4 }, t & 3)[3];
}
console.log(sum, JSON.stringify(bag).length, Object.keys(bag).join());
const moved = Array.prototype.copyWithin.call({ length: 5, 0: "a", 1: "b", 2: "c" }, 3, 0); console.log(JSON.stringify(moved));
const set = new Stack(); console.log(Reflect.set(set, 2, "by Reflect"), Reflect.set(set, 2, "on another", bag), JSON.stringify(set), bag[2]);
function tell(name, o, x) { try { console.log(name, Array.prototype.push.call(o, x), JSON.stringify(o), Object.keys(o).join()); } catch (e) { console.log(name, e.constructor.name, e.message, JSON.stringify(o)); } }
tell("at the last index, before any setter lies above", { length: 4294967294 }, 7);
tell("past the last index, before any setter lies above", { length: 4294967295 }, 8);
tell("closed", Object.preventExtensions(new Stack()), 1);
tell("frozen", Object.freeze(new Stack()), 1);
tell("over a read-only element", Object.defineProperty(new Stack(), 0, { value: "kept", writable: false, enumerable: true }), 1);
const told = [];
tell("over an own setter", Object.defineProperty(new Stack(), 0, { set(v) { told.push(v); }, enumerable: true, configurable: true }), 2);
class Above {} class Under extends Above { constructor() { super(); this.length = 0; } }
tell("before a setter lies above", new Under(), 3);
Object.defineProperty(Above.prototype, 0, { set(v) { told.push("above " + v); }, configurable: true });
tell("below a setter", new Under(), 4);
tell("at the last index", { length: 4294967294 }, 5);
tell("past the last index", { length: 4294967295 }, 6);
console.log(told.join());
