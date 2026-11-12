// Shape returns an object, which a call by `.call` drops. In turn five unseen text lays an accessor under `w` on Shape.prototype: from there on the store in Box goes to the setter and no Box has a `w` of its own.
const other = { name: "other" };
function Shape(name) { this.name = name; return other; }
function Box(w) { Shape.call(this, "box"); this.w = w; }
Object.setPrototypeOf(Box.prototype, Shape.prototype);
globalThis.classes = { Shape, Box };
globalThis.stored = 0;
const change = (text) => (0, eval)(text);
function run(count) { let text = ""; for (let i = 0; i < count; i++) { if (i === 5) change("Object.defineProperty(classes.Shape.prototype, 'w', { get() { return 'g'; }, set(value) { stored += value; }, configurable: true });"); const made = new Box(i); text += made.name[0] + made.w + Object.keys(made).length; } return text; }
console.log(run(10), globalThis.stored, other.w);
