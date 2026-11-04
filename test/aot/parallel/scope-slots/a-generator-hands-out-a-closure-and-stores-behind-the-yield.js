// Whoever steps the generator calls the closure while the body is suspended in front of the store.
function* gen() {
  const read = () => late;
  yield read;
  const late = 1;
  yield read;
}
function tryCall(f) { try { return f(); } catch (e) { return e.name; } }
function run() { const out = []; for (const f of gen()) out.push(tryCall(f)); return out.join(); }
for (let round = 0; round < 3; round++) console.log(run());
