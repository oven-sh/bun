const lines = [];
function log(...parts) { lines.push(parts.map(String).join(" ")); }

function restLength(...r) { return r.length; }
function restLengthAfterFirst(a, ...r) { return r.length; }
function restLengthOrFirst(...r) { return r.length ? r[0] : "none"; }
function restAfterPush(...r) { r.push(1, 2); return r.length; }
function restAfterPop(...r) { const last = r.pop(); return r.length + ":" + last; }
function restAfterLengthStore(...r) { r.length = 1; return r.length + ":" + r[1]; }
function restAfterGrowingStore(...r) { r[5] = "x"; return r.length + ":" + (3 in r); }
function restAfterDelete(...r) { delete r[r.length - 1]; return r.length; }
function restEscapes(...r) { kept.push(r); return r.length; }
function restLengthThenEscapes(...r) { const n = r.length; kept.push(r); r.push(0); return n + ":" + r.length; }
const kept = [];

function literalLength(a, b) { return [a, b].length; }
function literalWithHoles(a) { return [, a, , ].length; }
function literalWithSpread(a, b) { return [...a, 0, ...b].length; }
function emptyLiteral() { return [].length; }
function lengthInLoop(n) { let s = 0; for (let i = 0; i < n; i++) s += [i, s, n].length; return s; }
function lengthOnOnePath(flag, a) { const list = [a, a]; if (flag) list.push(a); return list.length; }
function lengthAfterCall(f, a) { const list = [a]; f(list); return list.length; }

function sliceLength(s, a, b) { return s.slice(a, b).length; }
function substringLength(s, a, b) { return s.substring(a, b).length; }
function sliceFrom(s, a) { return s.slice(a).length; }
function substringFrom(s, a) { return s.substring(a).length; }
function sliceOfSlice(s, a, b) { return s.slice(a).slice(0, b).length; }

const text = "0123456789";
const positions = [0, 1, 5, 9, 10, 11, 100, -1, -5, -10, -11, 2.7, -2.7, NaN, Infinity, -Infinity, undefined, null, "3", true];
for (let round = 0; round < 200; round++) {
  const all = [
    restLength(), restLength(1), restLength(1, 2, 3), restLength(undefined, undefined), restLength(...[1, 2], ...[3]),
    restLengthAfterFirst(), restLengthAfterFirst(1), restLengthAfterFirst(1, 2, 3),
    restLengthOrFirst(), restLengthOrFirst("a", "b"), restAfterPush(), restAfterPush(9), restAfterPop(), restAfterPop(7, 8),
    restAfterLengthStore(1, 2, 3), restAfterLengthStore(), restAfterGrowingStore(1), restAfterDelete(1, 2), restEscapes(1, 2), restLengthThenEscapes(1),
    literalLength(1, 2), literalWithHoles(1), literalWithSpread([1, 2], "abc"), literalWithSpread([], []), emptyLiteral(), lengthInLoop(4),
    lengthOnOnePath(true, 1), lengthOnOnePath(false, 1), lengthAfterCall(list => list.push(1, 2), 0), lengthAfterCall(list => { list.length = 0; }, 0),
  ];
  const ranges = [];
  for (const a of positions) {
    ranges.push(sliceFrom(text, a), substringFrom(text, a));
    for (const b of positions) ranges.push(sliceLength(text, a, b), substringLength(text, a, b), sliceOfSlice(text, a, b));
  }
  if (round === 0 || round === 199) { log(round, all.join(" ")); log(round, ranges.join("")); }
}
log(kept.length, kept[0].length, kept[1].length);
console.log(lines.join("\n"));
