function fail(at) { throw new Error(at); }
function* first(v) { if (v === 0) fail("before"); yield v; if (v === 1) fail("after"); yield v; }
function* looped(v) { for (let k = 0; k < 3; k++) { if (k === v) fail("k" + k); yield k; } fail("end"); }
const frames = error => error.stack.split("\n").slice(1, 5).map(line => line.trim().replace(/\(?[^\s()]*[\\/][^:]*/, "").replace(/:(\d+):\d+/, ":$1")).filter(line => !/next \(|\bnext$/.test(line)).slice(0, 3).join(" | ");
function ofFirst(v) {
  const it = first(v);
  let r = it.next();
  while (!r.done)
    r = it.next();
}
function ofLooped(v) {
  const it = looped(v);
  for (let r = it.next();
    !r.done;
    r = it.next()) if (r.value > 9) break;
}
function inside(v) {
  const it = looped(v);
  let r;
  while (!(r = it.next()).done) if (r.value > 9) break;
}
for (let turn = 0; turn < 2; turn++) for (const f of [ofFirst, ofLooped, inside]) for (let v = 0; v < 4; v++) {
  try { f(v); console.log(v, "fine"); } catch (error) { console.log(v, error.message, frames(error)); }
}
