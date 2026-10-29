// Subclasses of readable constructed in callbacks.
const { Readable } = require("node:stream");
class Sub extends Readable { constructor(id) { super(); this.id = id; this.kind = this.describe(); } describe() { return "Sub"; } }
class Lower extends Sub { extra = "x"; describe() { return "Lower " + this.extra; } }
const made = [];
[1, 2].forEach(id => { made.push(new Sub(id)); made.push(new Lower(id)); });
console.log([3, 4].every(id => new Lower(id).id === id), [5].map(id => new Sub(id).kind).join());
console.log(made.map(o => o.id + ":" + o.kind + ":" + o.extra + ":" + (o instanceof Readable)).join());
