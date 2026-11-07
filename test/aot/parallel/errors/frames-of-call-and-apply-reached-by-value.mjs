// Function.prototype.call and apply run in a frame of their own unless the call is written `f.call(..)` or `f.apply(..)`.
// The frame shows when the callee is not callable, and is gone once the callee runs.
const frames = error => error.message.replace(/ \((In|evaluating) '.*$/, "") + " | " + String(error.stack).split("\n").filter(line => /^\s+at /.test(line)).slice(0, 4).map(line => line.trim().replace(/\(?[^\s(]*[\\/]([^\\/\s:]+:\d+:\d+)\)?/, "$1")).join(" < ");
const show = (label, run) => { try { console.log(label, String(run())); } catch (error) { console.log(label, frames(error)); } };
const hide = value => [value][0];
const call = Function.prototype.call, apply = Function.prototype.apply;
function otherKeyTail(o) { return o.run(null); }
function otherKeyNotTail(o) { const r = o.run(null); return r + 1 + r; }
function otherKeyApplyTail(o) { return o.run(null, []); }
function callCallTail(f) { return Function.prototype.call.call(f, null, 1); }
function callCallNotTail(f) { const r = Function.prototype.call.call(f, null, 1); return r + 1 + r; }
function applyCallTail(f) { return Function.prototype.apply.call(f, null, [1]); }
function callApplyTail(f) { return Function.prototype.call.apply(f, [null, 1]); }
function variableTail(f) { const c = hide(call); return c.call(f, 1); }
function reflectTail(f) { return Reflect.apply(call, f, [null]); }
function boundTail(f) { return call.bind(f)(); }
function badList(f) { return f.apply(null, 5); }
function badListOtherKey(o) { return o.run(null, 5); }
function fine() { throw new Error("entered"); }
for (let round = 0; round < 2; round++) {
  for (const value of [{}, 5, undefined, fine]) {
    const kind = typeof value;
    show(kind + " otherKeyTail", () => otherKeyTail(Object.assign(typeof value === "function" ? value : Object(value ?? {}), { run: call })));
    show(kind + " otherKeyNotTail", () => otherKeyNotTail(Object.assign(typeof value === "function" ? value : Object(value ?? {}), { run: call })));
    show(kind + " otherKeyApplyTail", () => otherKeyApplyTail(Object.assign(typeof value === "function" ? value : Object(value ?? {}), { run: apply })));
    show(kind + " callCallTail", () => callCallTail(value));
    show(kind + " callCallNotTail", () => callCallNotTail(value));
    show(kind + " applyCallTail", () => applyCallTail(value));
    show(kind + " callApplyTail", () => callApplyTail(value));
    show(kind + " variableTail", () => variableTail(value));
    show(kind + " reflectTail", () => reflectTail(value));
    show(kind + " boundTail", () => boundTail(value));
  }
  show("map call", () => [1].map(call));
  show("reduce apply", () => [0, []].reduce(apply));
  show("map hidden call", () => [1].map(hide(call)));
  show("sort call", () => [2, 1].sort(call));
  show("replace call", () => "a".replace("a", call));
  show("from call", () => Array.from([1], call));
  show("badList", () => badList(fine));
  show("badListOtherKey", () => badListOtherKey(Object.assign(() => 1, { run: apply })));
}
