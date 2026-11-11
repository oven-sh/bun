class Box { static all = []; #inner = { v: 0 }; open = { v: 1 }; constructor(i) { this.#inner.v = i; Box.all.push(this.#inner); } get inner() { return this.#inner; } static make(i) { const b = new Box(i); return b.inner; } }
function run(i) { const b = new Box(i); return b.open; }
console.log(Box.make(3).v, run(4).v, Box.all.map(o => o.v).join());
