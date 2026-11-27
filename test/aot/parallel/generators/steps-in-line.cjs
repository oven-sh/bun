// STATISTIC: GeneratorStepsInLine >= 1
// A loop over what nobody knows steps a suspended generator in line. Every state of a generator, and every other iterable, goes through the same loop.
function* range(from, to, step = 1) { for (let i = from; i <= to; i += step) yield i; }
function* halves(n) { let x = n; while (x >= 1) { yield x; x /= 2; } return "over"; }
function* texts(list) { try { for (const text of list) yield text + "!"; } finally { closed++; } }
function* throwing(n) { for (let i = 0; i < n; i++) yield i; throw new RangeError("thrown " + n); }
let closed = 0;
function sum(data) { let s = 0; for (const v of data) s = s * 3 % 1009 + v; return s; }
function join(data) { let s = ""; for (const v of data) s += v; return s; }
function first(data) { for (const v of data) return v; return "none"; }
function upTo(data, limit) { const out = []; for (const v of data) { if (v > limit) break; out.push(v); } return out.join(); }
function* filter(fn, data) { for (const v of data) if (fn(v)) yield v; }
function* pass(data) { for (const v of data) yield v; }
function attempt(f, ...given) { try { return f(...given); } catch (e) { return e.name + ": " + e.message; } }
const started = range(1, 9); started.next(); started.next();
const ended = range(1, 2); for (const v of ended);
const running = (function* () { yield attempt(join, running); yield 2; })();
const own = range(1, 3); own.next = () => ({ done: closed > 100, value: closed++ });
const replaced = range(1, 3); Object.setPrototypeOf(replaced, { [Symbol.iterator]() { return [7, 8][Symbol.iterator](); } });
const makers = [() => range(1, 50), () => range(0, 1, 0.25), () => range(2147483640, 2147483655), () => range(9007199254740989, 9007199254740991), () => range(5, 1), () => halves(1000), () => texts(["a", "b"]), () => throwing(3), () => [1, 2, 3], () => new Set([4, 5]), () => new Map([[1, 2]]).values(), () => "xyz", () => filter(v => v % 7 === 0, range(1, 60)), () => pass(pass(range(1, 5))), () => filter(v => v, pass([0, 1, "", 2]))];
for (const make of makers) {
  console.log(attempt(sum, make()), attempt(join, make()), attempt(first, make()), attempt(upTo, make(), 20), attempt(join, pass(make())), attempt(join, filter(v => v, make())));
}
console.log(join(started), join(ended), attempt(join, running), closed, join(replaced));
for (const v of own) { if (closed > 120) break; closed += 5; }
console.log(closed, attempt(join, 5), attempt(join, null), attempt(join, { [Symbol.iterator]: 1 }));
const shared = range(1, 10); let seen = "";
for (const v of shared) { seen += v + ":"; if (v === 4) for (const w of shared) { seen += w + ";"; if (w === 6) break; } }
console.log(seen, shared.next().done);
