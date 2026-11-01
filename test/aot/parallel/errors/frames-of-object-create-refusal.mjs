// A trace of the prototype that Object.create refuses names Object.create, also where the compiler makes the object in place.
const names = e => String(e.stack).split("\n").slice(1, 5).map(l => l.trim().replace(/\(?[^ (]*[\\/]/, "(")).join(" < ");
function constant() { const r = Object.create(1); return r + 1; }
function given(p) { const r = Object.create(p); r.x = 1; return r.x; }
function inTailPosition(p) { return Object.create(p); }
function withMembers(p) { const r = Object.create(p); r.a = 1; r.b = 2; return r.a + r.b; }
const parsed = JSON.parse('[1, "a", true]');
for (const run of [constant, () => { const r = given(parsed[0]); return r; }, () => { const r = inTailPosition(parsed[1]); return r; }, () => { const r = withMembers(parsed[2]); return r; }, () => { const r = withMembers(undefined); return r; }]) {
  try { run(); console.log("did not throw"); } catch (e) { console.log(e.message, names(e)); }
}
console.log(given(null), given({}), withMembers(null));
