// for await over async generators in loops and in async generators: as made, with members of their own, below a changed prototype, below another one, and other iterables in their place.
const out = [];
const log = text => out.push(text);
async function* numbers(n) { for (let i = 0; i < n; i++) yield i; }
async function* words(n) { for (let i = 0; i < n; i++) yield "w" + i; }
async function* patched(n) { yield* numbers(n); }
const holder = { async *m(n) { yield n; }, async *o(n) { yield [n]; } };
class Source { constructor(n) { this.n = n; } async *[Symbol.asyncIterator]() { yield* numbers(this.n); } async *each() { for await (const v of this) yield v * 2; } }

const kinds = [
  n => numbers(n), n => words(n), n => holder.m(n), n => holder["o"](n), n => new Source(n), n => new Source(n).each(), n => patched(n),
  n => { const g = numbers(n); g.next = () => Promise.resolve({ done: true, value: log("own next") }); return g; },
  n => { const g = numbers(n); g[Symbol.asyncIterator] = function () { log("own iterator"); return words(n); }; return g; },
  n => { const g = numbers(n); g.extra = 1; return g; },
  n => { const g = numbers(n); g[0] = "element"; return g; },
  n => Object.setPrototypeOf(numbers(n), { __proto__: Object.getPrototypeOf(words.prototype), next() { log("next of another"); return Promise.resolve({ done: true }); } }),
  n => Object.setPrototypeOf(numbers(n), words.prototype),
  n => Object.freeze(numbers(n)),
  n => [n, Promise.resolve(n + 1)], n => new Set([n]), n => "ab", n => ({ [Symbol.asyncIterator]() { let i = 0; return { next: async () => ({ done: i++ >= n, value: "by hand" + i }) }; } }),
];
async function run(make, n) { const seen = []; for await (const v of make(n)) seen.push(String(v)); return seen.join(); }
async function* relay(make, n) { for await (const v of make(n)) yield v; }
async function* relayTwice(make, n) { for (let i = 0; i < 2; i++) for await (const v of relay(make, n)) { if (v === 1) continue; yield v; } }
async function all(label) {
  for (const [place, make] of kinds.entries()) {
    for (let n = 0; n < 3; n++) {
      try { log(`${label}${place}.${n} ${await run(make, n)} | ${await run(m => relay(make, m), n)} | ${await run(m => relayTwice(make, m), n)}`); } catch (e) { log(`${label}${place}.${n} ${e.constructor.name}`); }
      let total = 0;
      for (let k = 0; k < 3; k++) { try { for await (const v of make(n)) { total += typeof v === "number" ? v : 1; if (k === 2) break; } } catch (e) { log(e.constructor.name); } }
      log("total " + total);
    }
  }
  try { for (let k = 0; k < 2; k++) for await (const v of Object.setPrototypeOf(numbers(1), null)) log("null " + v); } catch (e) { log(e.constructor.name); }
  try { for (let k = 0; k < 2; k++) for await (const v of k ? undefined : numbers(1)) log("first " + v); } catch (e) { log(e.constructor.name); }
}
await all("a");
patched.prototype.next = function (...given) { log("next of patched"); return Object.getPrototypeOf(numbers.prototype).next.apply(this, given); };
await all("b");
numbers.prototype[Symbol.asyncIterator] = function () { log("iterator of numbers"); return this; };
await all("c");
words.prototype = null;
await all("d");
const twice = numbers(4);
for (let k = 0; k < 2; k++) for await (const v of twice) { log("twice " + v); if (v) break; }
for (const line of out) console.log(line);
