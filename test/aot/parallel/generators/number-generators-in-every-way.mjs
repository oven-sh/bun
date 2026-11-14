// Generators of numbers, stepped by loops over what nobody knows, by hand, left, thrown into and kept.
// Env: BUN_JSC_slowPathAllocsBetweenGCs=3
const log = [];
function* count(from, to) { for (let i = from; i <= to; i++) yield i; }
function* down(from, to) { for (let i = from; i > to; --i) yield i; }
function* range(from, to, step = 1) { const by = from < to ? Math.abs(step) : -Math.abs(step); for (let i = from; from < to ? i <= to : i >= to; i += by) yield i; }
function* fibonacci(limit) { let a = 0, b = 1, t; for (;;) { yield a; t = a; a = b; b += t; if (a > limit) return "over"; } }
function* both(from, to) { for (let i = from; i <= to; i++) { yield i; yield -i; } }
function* sent(from, to) { let last = 0; for (let i = from; i <= to; i++) { last = yield i; if (typeof last === "number") i += last; } }
function* closed(from, to) { try { for (let i = from; i <= to; i++) yield i; } finally { log.push("closed"); } }
function* evens(from, to) { let k = 0; for (let i = from; i <= to; i++) { if (k % 2 === 0) yield i; k = k + 1; } }
function* powers(base) { for (let i = 1; i < 2 ** 60; i *= base) yield i; }
const generators = { count, down, range, fibonacci, both, sent, closed, evens, powers };

const text = value => Object.is(value, -0) ? "-0" : String(value);
const filter = test => data => ({ *[Symbol.iterator]() { let i = 0; for (const x of data) { if (!test(x, i++)) continue; yield x; } } });
const map = make => data => ({ *[Symbol.iterator]() { let i = 0; for (const x of data) yield make(x, i++); } });
let garbage = [];
const uses = {
  loop(it) { const out = []; for (const x of it) { out.push(text(x)); if (out.length > 12) break; } return out.join(); },
  junk(it) { const out = []; for (const x of it) { garbage.push([x, { x }]); if (garbage.length > 200) garbage = []; out.push(text(x)); if (out.length > 12) break; } return out.join(); },
  hand(it) { const out = []; let r, n = 0; while (!(r = it.next(n)).done && n++ < 9) out.push(text(r.value)); return out.join() + "|" + r.value + r.done; },
  left(it) { const out = []; try { for (const x of it) { out.push(text(x)); if (out.length === 4) throw new Error("stop"); } } catch (error) { out.push(error.message); } return out + JSON.stringify(it.next()); },
  mixed(it) { const out = []; for (const x of it) { out.push(text(x)); if (out.length % 3 === 0) out.push("[" + text(it.next().value) + "]"); if (out.length > 12) break; } return out.join(); },
  returned(it) { it.next(); it.next(); return JSON.stringify(it.return(3)) + JSON.stringify(it.next()); },
  thrown(it) { it.next(); it.next(); try { return JSON.stringify(it.throw(new Error("thrown"))); } catch (error) { return error.message + JSON.stringify(it.next()); } },
  chain(it) { const out = []; for (const x of map(x => x + 1)(filter(x => x !== 3)(it))) { out.push(text(x)); if (out.length > 12) break; } return out.join(); },
  turns(it) { const other = count(5, 9), out = []; for (let n = 0; n < 8; n++) out.push(text(it.next().value) + "/" + text(other.next().value)); return out.join(); },
};
const numbers = [[0, 5], [1, 4], [5, 0], [-3, 2], [0.5, 3], [-0, 1], [2 ** 31 - 2, 2 ** 31 + 1], [-(2 ** 31), -(2 ** 31) + 2], [2 ** 53 - 1, 2 ** 53 + 4], [NaN, 3], [0, NaN], [0, Infinity], ["1", "3"], [undefined, 2], [true, 3]];
for (let round = 0; round < 2; round++) {
  for (const name in generators) {
    for (const use in uses) {
      const answers = numbers.map(([from, to]) => {
        let result;
        try { result = uses[use](generators[name](from, to)); } catch (error) { result = error.name; }
        result += log.join(""); log.length = 0;
        return result;
      });
      if (round) console.log(name, use, answers.join(" ; "));
    }
  }
}
console.log([[1, 2], new Set([3]), new Map([[4, 5]]), "ab"].map(x => uses.loop(x)).join(" ; "));
count.prototype.next = function () { return { done: true }; };
console.log(uses.loop(count(1, 4)) + "|" + uses.hand(count(1, 4)));
