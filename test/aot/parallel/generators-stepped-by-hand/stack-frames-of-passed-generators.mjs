function fail(at) { throw new Error(at); }
function* first(v) { if (v === 0) fail("before"); yield v; if (v === 1) fail("after"); yield v; }
function* looped(v) { for (let k = 0; k < 3; k++) { if (k === v) fail("k" + k); yield k; } fail("end"); }
const frames = error => error.stack.split("\n").slice(1, 5).map(line => line.trim().replace(/\(?[^\s()]*[\\/][^:]*/, "").replace(/:(\d+):\d+/, ":$1")).filter(line => !/next \(|\bnext$/.test(line)).slice(0, 3).join(" | ");
function front(make, v) {
  const it = make(v);
  let r = it.next();
  let t = 0;
  while (!r.done) {
    t += r.value;
    r = it.next();
  }
  return t;
}
function head(make, v) {
  const it = make(v);
  let t = 0;
  for (let r = it.next();
    !r.done;
    r = it.next())
    t += r.value;
  return t;
}
function inside(make, v) {
  const it = make(v);
  while (true) {
    const r = it.next();
    if (r.done) return r;
  }
}
function drive(it) {
  let r = it.next();
  while (!r.done)
    r = it.next();
  return r;
}
function ofFirst(v) {
  const it = first(v);
  let r = it.next();
  while (!r.done)
    r = it.next();
}
function ofLooped(v) {
  const it = looped(v);
  let r = it.next();
  while (!r.done)
    r = it.next();
}
function driven(v) {
  return drive(
    looped(v));
}
function drivenFirst(v) {
  return drive(first(v));
}
function over(v) {
  for (const x of looped(v))
    if (x > 5) break;
}
for (let turn = 0; turn < 2; turn++) for (const f of [v => front(first, v), v => head(looped, v), v => inside(looped, v), ofFirst, ofLooped, driven, drivenFirst, over]) for (let v = 0; v < 4; v++) {
  try { f(v); console.log(v, "fine"); } catch (error) { console.log(v, error.message, frames(error)); }
}
