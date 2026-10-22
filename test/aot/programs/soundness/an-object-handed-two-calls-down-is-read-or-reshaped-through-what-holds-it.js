// What holds the object is handed on, and whoever gets it reads the object, adds a property, deletes one, freezes it, or gives it another prototype. The maker of the
// object is two calls away: a store in front of the call is not dead, and what it knew of the object's shape no longer holds behind the call.
const seen = [];
function read(h) { seen.push(h.inner.x); }
function holdToRead(o) { read({ inner: o }); }
function viaRead(o) { holdToRead(o); }
function storesAroundTheCall() { const o = { x: 0 }; o.x = 5; viaRead(o); o.x = 6; return o.x; }

function grow(h) { h.inner.extra = 7; }
function holdToGrow(o) { grow({ inner: o }); }
function viaGrow(o) { holdToGrow(o); }
function grown() { const o = { x: 1 }; viaGrow(o); return [o.x, o.extra, Object.keys(o).join("+")].join(); }

function shrink(h) { delete h.inner.x; }
function holdToShrink(o) { shrink({ inner: o }); }
function viaShrink(o) { holdToShrink(o); }
function shrunk() { const o = { x: 1, y: 2 }; viaShrink(o); return [o.x, o.y, "x" in o, Object.keys(o).join("+")].join(); }

function freeze(h) { Object.freeze(h.inner); }
function holdToFreeze(o) { freeze({ inner: o }); }
function viaFreeze(o) { holdToFreeze(o); }
function frozen() {
  const o = { x: 1 };
  viaFreeze(o);
  let refused = false;
  try { o.x = 2; } catch { refused = true; }
  return [o.x, refused, Object.isFrozen(o)].join();
}

function reparent(h) { Object.setPrototypeOf(h.inner, { inherited: 9 }); }
function holdToReparent(o) { reparent({ inner: o }); }
function viaReparent(o) { holdToReparent(o); }
function reparented() { const o = { x: 1 }; const before = o.inherited; viaReparent(o); return [before, o.inherited].join(); }

function define(h) { Object.defineProperty(h.inner, "x", { get() { return 42; } }); }
function holdToDefine(o) { define({ inner: o }); }
function viaDefine(o) { holdToDefine(o); }
function defined() { const o = { x: 1 }; viaDefine(o); return o.x; }

function push(h) { h.inner.push(3); h.inner[0] = 10; }
function holdToPush(list) { push({ inner: list }); }
function viaPush(list) { holdToPush(list); }
function pushed() { const list = [1, 2]; viaPush(list); return [list.length, list[0], list.join("+")].join(); }

for (let round = 0; round < 2; round++) {
  console.log(storesAroundTheCall(), seen.join(), grown(), shrunk(), frozen(), reparented(), defined(), pushed());
}
