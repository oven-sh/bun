// The closure is out, the body waits, and somebody calls.
let kept;
function tryCall(f) { try { return f(); } catch (e) { return e.name; } }
async function run() {
  kept = () => late;
  await 0;
  const late = 2;
  return tryCall(kept);
}
const out = [];
const done = run();
out.push(tryCall(kept));
out.push(await done);
console.log(out.join());
