// Steps in a row of generators whose loops never end.
let state = 0;
const lines = [];
const show = v => (typeof v === "function" ? "function" : typeof v === "object" && v !== null ? JSON.stringify(v) : Object.is(v, -0) ? "-0" : String(v));
const say = (...words) => lines.length < 3000 && lines.push(words.map(show).join(" "));
const list = JSON.parse("[3,1,4,1,5,9,2,6]"), doubles = JSON.parse("[0.5,-1.5,2]");
function* ids(k) { while (true) yield k++; }
function* twoAtOnce(k) { for (;;) { yield k; state += k; yield [k++, state]; } }
function* counted(k) { for (let j = 0; ; j++) { state += j; yield j * k; } }
function* sums(t) { while (true) { const got = yield t; t += got === undefined ? 1 : got; } }
function* asked(k) { do { k = (yield k) ?? k + 10; state++; } while (true); }
function* fails(k) { let n = 0; while (true) { if (n++ === 2) throw new RangeError("third"); yield k + n; } }
function* early(k) { while (true) { if (k > 6) return "large"; yield k; k += 2; } }
const frames = error => error.stack.split("\n").slice(1, 3).map(line => line.trim().replace(/\(?[^\s()]*[\\/][^:]*/, "").replace(/:(\d+):\d+/, ":$1")).join(" | ");
function three(x) { const it = ids(x); const a = it.next().value, b = it.next().value; return a * b + it.next().value; }
function four(x) { const it = twoAtOnce(x); const a = it.next(), b = it.next(), c = it.next(), d = it.next(); return say(a, b, c, d, state); }
function kept(x) { const it = counted(x); const a = it.next(); state -= 1; const b = it.next(); const f = () => a.value + b.value; a.value = x; return say(f(), it.next(), a === b); }
function sent(x) { const it = sums(x); const a = it.next(); const b = it.next(a.value); const c = it.next(); const d = it.next(b); return say(a, b, c, d); }
function given(x) { const it = asked(x); const a = it.next().value; const b = it.next(x > 2 ? a : undefined).value; return say(a, b, it.next(null).value, state); }
function failing(x) {
  const it = fails(x);
  const a = it.next();
  const b = it.next();
  return say(a, b,
    it.next());
}
function leaving(x) { const it = early(x); const a = it.next(), b = it.next(); return say(a, b, it.next()); }
function one(x) { return ids(x).next().value + counted(x).next().value; }
for (let turn = 0; turn < 3; turn++) {
  for (const values of [list, doubles]) {
    let total = 0;
    for (const x of values) {
      total += three(x) + one(x);
      for (const f of [four, kept, sent, given, failing, leaving]) { try { f(x); } catch (error) { say(error.message, frames(error)); } }
      const it = sums(total);
      it.next();
      total = it.next(x).value;
      say(total, it.next(1).value, state);
    }
  }
}
for (const line of lines) console.log(line);
console.log(lines.length, state);
