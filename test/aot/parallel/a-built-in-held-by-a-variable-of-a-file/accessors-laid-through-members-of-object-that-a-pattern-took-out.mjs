// Accessors and values laid on prototypes through Object.defineProperties | defineProperty | create | setPrototypeOf | assign, each taken out of Object by a pattern under another name.
const { defineProperties: define, defineProperty: one, create, setPrototypeOf: below, assign } = Object;
function Pile() { this.bits = 0; }
define(Pile.prototype, { full: { get() { return (this.bits & 1) !== 0; }, set(value) { if (value) this.bits |= 1; else this.bits &= ~1; } } });
one(Pile.prototype, "half", { get() { return this.bits / 2; } });
function Heap() { Pile.call(this); }
Heap.prototype = create(Pile.prototype, { top: { value: 9, writable: true } });
const bare = below({ own: 1 }, Pile.prototype);
const pile = new Pile(), heap = new Heap();
let out = "";
for (let turn = 0; turn < 300; turn++) { pile.full = turn % 2 === 0; heap.full = true; out = [pile.full, pile.bits, pile.half, heap.full, heap.top, heap.half, bare.full, assign({}, pile).bits].join(); }
console.log(out, Object.keys(pile).join());
