// A setter that a store under a key of known text calls: no built-in stands between it and the store in the stack of what it throws.
class Box {
  constructor() { this.held = 1; }
  get size() { return this.held; }
  set size(value) { if (value < 0) throw new RangeError("size " + value); this.held = value; }
  static set limit(value) { if (value > 9) throw new TypeError("limit " + value); Box.last = value; }
}
const literal = { seen: 0, set depth(value) { if (value === 3) null.depth; this.seen = value; } };
const size = "size";
function put(object, key, value) { object[key] = value; }
function store(object, value) { object[size] = value; }
const frames = (error) => error.stack.split("\n").filter((line) => line.includes("at ")).map((line) => line.trim().split(" ")[1]).slice(0, 2).join(" < ");
const lines = [];
const attempt = (f) => { try { f(); lines.push("stored"); } catch (error) { lines.push(error.constructor.name + " " + frames(error)); } };
const box = new Box();
for (let k = 0; k < 40; k++) { put(box, "size", k & 7); store(box, k & 3); put(literal, "depth", 1); }
lines.push(box.size + " " + literal.seen);
attempt(() => put(box, "size", -1));
attempt(() => store(box, -2));
attempt(() => put(Box, "limit", 10));
attempt(() => put(Box, "limit", 9));
attempt(() => put(literal, "depth", 3));
attempt(() => put(literal, "depth", 4));
attempt(() => put(Object.freeze({ get size() { return 1; } }), "size", 4));
lines.push(box.size + " " + Box.last + " " + literal.seen);
console.log(lines.join("\n"));
