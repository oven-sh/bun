// Generators stepped by hand one step after the other: what stands before, between and after the steps, what is sent, results that are kept.
let state = 0;
const lines = [];
const show = v => (typeof v === "function" ? "function" : typeof v === "object" && v !== null ? JSON.stringify(v) : Object.is(v, -0) ? "-0" : String(v));
const say = (...words) => lines.length < 3000 && lines.push(words.map(show).join(" "));
const list = JSON.parse("[3,1,4,1,5,9,2,6]");
const bump = v => { state += 3; return v; };
let held = null;

function* range(a, b) { for (let k = a; k < b; k++) yield k; return "end"; }
function* pair(v) { yield v; state++; yield v + 1; state += 2; return v + 2; }
function* sends(v) { const a = yield v; const b = yield [a, v]; return [a, b]; }
function* either(v) { if (v > 3) { const got = yield "large"; state += got ?? 1; } else yield "small"; yield state; }
function* nested(v) { for (let k = 0; k < 2; k++) { for (let j = 0; j < v % 3; j++) yield k * 10 + j; state++; } }
function* some(v) { for (let k = 0; k < v; k++) if (k % 2 === v % 2) yield k; }
function* guarded(v) { try { yield v; if (v === 4) throw new Error("four"); yield v + 1; } catch (error) { yield error.message; } finally { state += 5; } }
function* throwing(v) { yield v; if (v === 5) throw new RangeError("five"); yield v + 1; }
function* none() { state += 7; }
function* reading() { yield state; yield state; yield state; }
function* defaulted(v = bump(2), [w] = [v]) { yield v + w; yield w; }
const methods = { n: 4, *values(v) { this.n++; yield this.n + v; yield this.n - v; } };
const makers = [range, pair, sends, either, nested, some, guarded, throwing, none, reading, defaulted];

function one(x) { const it = range(x, x + 2); return it.next().value; }
function oneOf(x) { return pair(x).next().value; }
function done(x) { const { value, done } = some(x).next(); return say(value, done); }
function two(x) { const it = pair(x); return say(it.next().value + it.next().value, state); }
function three(x) { const it = range(x, 5); const a = it.next(); state += 1; const b = it.next(a.value); const c = it.next(); return say(a, b, c, a === b); }
function four(x) { const it = nested(x); const a = it.next(), b = it.next(), c = it.next(), d = it.next(); return say(a.value, b.value, c.done, d.value, state); }
function sent(x) { const it = sends(x); const a = it.next(1); const b = it.next(a.value * 2); const c = it.next(b); return say(a, b, c); }
function kept(x) { const it = either(x); const a = it.next(); held = a; let t = x > 2 ? x : "t"; const b = it.next(t); a.value = "changed"; t = [t, b.value]; const c = it.next(t); return say(a, b, c, t, held === a); }
function literal(x) { const it = range(x, 6); return say([it.next().value, it.next().value], { a: it.next().value, b: x }); }
function template(x) { const it = some(x); return say(`${it.next().value} ${bump(x)} ${it.next().done}`); }
function argument(x) { const it = range(x, 4); return say(it.next().value, bump(it.next().value), it.next()); }
function caught(x) { try { const it = throwing(x); const a = it.next(); state++; return say(a.value, it.next().value); } catch (error) { return say(error.name, x, state); } }
function inHandlers(x) { try { if (x > 4) throw x; return say("fine"); } catch (error) { const it = pair(error); return say(it.next().value, it.next().value); } finally { const it = reading(); say(it.next().value, (state++, it.next().value)); } }
function generatorOf(x) { const it = guarded(x); const a = it.next(); const b = it.next(); return say(a, b, state); }
function between(x) { const it = reading(); const a = it.next().value; state += x; const b = it.next().value; if (x > 3) state -= a; const c = it.next().value; return say(a, b, c); }
function assigned(x) { const it = range(x, 7); let r = it.next(); const first = r.value; r = it.next(); const second = r.value; r = it.next(first + second); return say(first, second, r); }
function closures(x) { const it = pair(x); const a = it.next(); const f = () => a.value; const b = it.next(); const g = () => a.value + b.value; return say(f(), g()); }
function interleaved(x) { const it = pair(x), other = range(x, 9); return say(it.next().value, other.next().value, it.next().value, other.next().value); }
function chained(x) { const it = pair(x); const other = sends(it.next().value); const a = other.next(); return say(it.next(), other.next(a.value), other.next()); }
function ofMethod(x) { const it = methods.values(x); return say(it.next().value, it.next().value, methods.n); }
function ofDefaults(x) { const it = x > 4 ? null : 1; const made = it ? defaulted(undefined, [x]) : defaulted(x); const a = made.next(); return say(a.value, made.next().value, state); }
function empty(x) { const it = none(); const a = it.next(); return say(a, it.next(), state); }
function returned(x) { const it = guarded(x); const a = it.next(); return say(a, it.return(x), it.next(), state); }
function five(x) { const it = range(x, 99); it.next(); it.next(); it.next(); it.next(); return say(it.next().value); }
function early(x) { const it = pair(x); const a = it.next(); if (a.value > 4) return say("early", a); const b = it.next(); return say(b); }
const tests = [done, two, three, four, sent, kept, literal, template, argument, caught, inHandlers, generatorOf, between, assigned, closures, interleaved, chained, ofMethod, ofDefaults, empty, returned, five, early];
function run(n) {
  let total = 0;
  for (let turn = 0; turn < n; turn++) {
    for (const x of list) {
      total = (total + one(x) + oneOf(x) + turn) | 0;
      for (const test of tests) test(x);
      const it = pair(x - turn);
      const a = it.next();
      total = (total + a.value) | 0;
      const b = it.next(total);
      total = (total + b.value * 2) | 0;
      say(total, a, b, it.next().value, state);
    }
  }
  return total;
}
say(run(4));
function* around(n) { for (const x of list) { const it = sends(x + n); const a = it.next(); const got = yield a.value; yield it.next(got).value; } }
for (const v of around(2)) say(v);
for (const maker of makers) for (const x of list) { try { const it = maker(x); say(maker.name, it.next(), it.next(x)); } catch (error) { say(maker.name, error.name); } }
async function later(n) { let t = 0; for (const x of list) { const it = pair(x); const a = it.next().value; await null; t += a + n; const other = pair(t); t = (t + other.next().value + other.next().value) | 0; } return t; }
say(await later(3));
for (const line of lines.slice(0, 260).concat(lines.slice(-160))) console.log(line);
console.log(lines.length, state);
