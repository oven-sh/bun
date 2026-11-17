// A descriptor written in place that says yes to everything creates a field whose slot the plan lays raw, because the object never leaves the function: a fraction, a whole number, an object of one class.
// The value goes straight into the slot, in the slot's own form. What the slot cannot say for itself stays the run time's: undefined and null, which lie there as markers.
// COUNT: operation:operationAOTDefineOwnProperty <= 12
class Point { constructor(x) { this.x = x; } }
function fractions(n) { let s = 0; for (let i = 0; i < n; i++) { const o = {}; Object.defineProperty(o, "n", { value: i + 0.5, enumerable: true, writable: true, configurable: true }); s += o.n; } return s; }
function wholes(n) { let s = 0; for (let i = 0; i < n; i++) { const o = {}; Object.defineProperty(o, "w", { value: i & 1023, enumerable: true, writable: true, configurable: true }); s += o.w; } return s; }
function truths(n) { let s = 0; for (let i = 0; i < n; i++) { const o = {}; Object.defineProperty(o, "t", { value: (i & 1) === 1, enumerable: true, writable: true, configurable: true }); if (o.t) s++; } return s; }
function points(n) { let s = 0; for (let i = 0; i < n; i++) { const o = {}; Object.defineProperty(o, "p", { value: new Point(i), enumerable: true, writable: true, configurable: true }); s += o.p.x; } return s; }
function twice(n) { let s = 0; for (let i = 0; i < n; i++) { const o = {}; Object.defineProperty(o, "n", { value: i + 0.25, enumerable: true, writable: true, configurable: true }); s += o.n; o.n = i + 0.75; s += o.n; } return s; }
function orNothing(n) { let s = 0; for (let i = 0; i < n; i++) { const o = {}; Object.defineProperty(o, "u", { value: i & 1 ? i + 0.5 : undefined, enumerable: true, writable: true, configurable: true }); s += o.u === undefined ? 1 : o.u; } return s; }
console.log(fractions(3000), wholes(3000), truths(3000), points(3000), twice(3000), orNothing(4));
console.log(fractions(2), wholes(2), truths(2), points(2), twice(2), orNothing(3));
