// In turn five unseen text lays a `call` of its own on Shape. It counts the keys that the object has when it arrives: none, since nothing was stored yet.
function Shape(name) { this.name = name; this.id = 0; }
function Box(w, h) { Shape.call(this, "box"); this.w = w; this.h = h; }
function Disc(r) { Shape.call(this, "disc"); this.r = r; }
Object.setPrototypeOf(Box.prototype, Shape.prototype);
Object.setPrototypeOf(Disc.prototype, Shape.prototype);
globalThis.classes = { Shape, Box, Disc };
globalThis.keysSeen = 0;
const change = (text) => (0, eval)(text);
function fill(count, out) { for (let i = 0; i < count; i++) { if (i === 5) change("classes.Shape.call = function (self, name) { keysSeen += Object.keys(self).length; self.id = 7; self.name = name + '!'; };"); out[i] = i & 1 ? new Box(i, 2) : new Disc(i); } }
const list = [];
fill(10, list);
console.log(list.map((s) => s.name + s.id + Object.keys(s).join("")).join(" "), globalThis.keysSeen);
