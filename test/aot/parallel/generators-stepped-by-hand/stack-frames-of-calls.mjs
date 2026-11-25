// An error that binding the parameters of a generator throws comes out of its call: the frames name the line of the call, not the line of the first step.
function fail(v) { if (v === 1 || v === null) throw new Error("failed"); return v; }
function* ofDefault(v, w = fail(v)) { yield w; if (v === 2) throw new Error("body"); yield v; }
function* ofPattern({ a }) { yield a; }
function* ofPair([a, b = fail(a)]) { yield a; yield b; }
const frames = error => error.stack.split("\n").slice(1).map(line => line.trim().replace(/\(?[^\s()]*[\\/][^:]*/, "").replace(/:(\d+):\d+/, ":$1")).filter(line => /fail|of[DP]|ByHand|inRow|overOne|apart|from/.test(line)).slice(0, 3).join(" | ");
function loopByHand(v) {
  const it = ofDefault(v);
  let t = 0;
  while (true) {
    const r = it.next();
    if (r.done) break;
    t += r.value;
  }
  return t;
}
function frontByHand(v) {
  let t = 0;
  const it = ofPattern(v);
  for (let r = it.next(); !r.done; r = it.next()) {
    t += r.value;
  }
  return t;
}
function pairByHand(v) {
  let r, t = 0;
  const it = ofPair(v);
  while (!(r = it.next()).done) {
    t += r.value;
  }
  return t;
}
function inRow(v) {
  const it = ofDefault(v);
  const a = it.next();
  const b = it.next();
  return a.value + b.value;
}
function overOne(v) {
  let t = 0;
  for (const x of
    ofDefault(
      v)) t += x;
  return t;
}
function apart(v) {
  const list = [0,
    ...ofPair(
      v)];
  const [a] =
    ofPattern(v);
  return list.length + a;
}
function from(v) {
  return Array.from(
    ofDefault(v)).length;
}
for (let turn = 0; turn < 4; turn++) {
  for (const f of [loopByHand, frontByHand, pairByHand, inRow, overOne, apart, from]) {
    for (const v of [0, 1, 2, null, undefined, [1], [2, 3], { a: 4 }]) {
      try {
        console.log(f.name, f(v));
      } catch (error) {
        console.log(f.name, error.name, frames(error));
      }
    }
  }
}
