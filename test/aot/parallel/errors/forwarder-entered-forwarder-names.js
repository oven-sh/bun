// Function.prototype.call and apply that are called through call or apply, written out and out of sight of the build: the one that finds its receiver not callable names no place.
// Built with every limit at its smallest value: nothing is inlined, and the functions of the library do the forwarding.
// Flags: --aot-limit=All:0
const hide = new Function("x", "return x");
const show = (label, run) => { try { console.log(label, run()); } catch (error) { console.log(label, error.name, error.message); } };
const notCallable = Object.create(Function.prototype);
const c = hide(Function.prototype.call), a = hide(Function.prototype.apply);
function both(x) { return [this, x].join(); }
for (let round = 0; round < 2; round++) {
  show("c.call", () => { const r = c.call(notCallable, null, 1); return [r]; });
  show("c.call in tail position", () => c.call(notCallable, null, 1));
  show("c.call of nothing", () => { const r = c.call(); return [r]; });
  show("c.apply", () => { const r = c.apply(notCallable, [null, 1]); return [r]; });
  show("a.call", () => { const r = a.call(notCallable, null, [1]); return [r]; });
  show("a.apply", () => { const r = a.apply(notCallable, [null, [1]]); return [r]; });
  show("a.apply in tail position", () => a.apply(notCallable, [null, [1]]));
  show("c.call.call", () => { const r = c.call.call(notCallable, null, 1); return [r]; });
  show("call.call", () => { const r = Function.prototype.call.call(notCallable, null, 1); return [r]; });
  show("call.call in tail position", () => Function.prototype.call.call(notCallable, null, 1));
  show("apply.apply", () => { const r = Function.prototype.apply.apply(notCallable, [null, [1]]); return [r]; });
  show("call.apply", () => { const r = Function.prototype.call.apply(notCallable, [null, 1]); return [r]; });
  show("apply.call", () => { const r = Function.prototype.apply.call(notCallable, null, [1]); return [r]; });
  show("they forward", () => [c.call(both, 7, 8), a.call(both, 7, [8]), c.apply(both, [7, 8]), a.apply(both, [7, [8]]), c.call(c, both, 7, 8), a.call(c, both, [7, 8]), c.call(a, both, 7, [8])].join(" "));
}
