// Stores into objects of constructor functions with captures, below setters, read-only names and changed prototypes.
const lines = []; const say = (...v) => lines.push(v.join(" "));
const lib = (function () {
  var registry = { set: [], made: 0 };
  function Item(x) { this.x = x; this.y = 1; this.z = "z"; registry.made++; }
  Item.prototype.get = function () { return this.x + "," + this.y + "," + this.z; };
  function Sub(x) { Item.call(this, x); this.w = 2; }
  Sub.prototype = Object.create(Item.prototype); Sub.prototype.constructor = Sub;
  return { Item, Sub, registry };
})();
const { Item, Sub, registry } = lib;
function make(n) { let r = ""; for (let i = 0; i < n; i++) { const o = new Item(i), s = new Sub(i); r += o.get() + "|" + s.get() + s.w + Object.keys(o) + Object.keys(s) + ";"; } return r; }
function fill(os) { for (let i = 0; i < os.length; i++) { os[i].y = i; os[i].z = "f"; } return os.map(o => o.get() + Object.keys(o)).join(); }
const late = [new Item(1), new Sub(2), new Item(3)];
delete late[0].y; delete late[2].z;
say(make(3)); say(fill(late));
Object.defineProperty(Item.prototype, "y", { get() { return "G"; }, set(v) { registry.set.push(v); }, configurable: true });
for (const o of late) delete o.y;
say(make(3)); say(fill(late), registry.set);
Object.defineProperty(Item.prototype, "z", { value: "fixed", writable: false, configurable: true });
for (const o of late) delete o.z;
say(make(2)); say(fill(late), registry.set.length);
delete Item.prototype.y; delete Item.prototype.z;
say(make(2)); say(fill(late), registry.made);
Object.setPrototypeOf(Sub.prototype, { set w(v) { registry.set.push("w" + v); }, get() { return "other"; } });
say(make(2), registry.set);
for (const l of lines) console.log(l);
