// Under: --aot-testing=CheckBoundsInEmittersOnly: the walk as users build it, and every raw store asks its position at the run.
"use strict";
function show(x) { if (x === null || x === undefined) return String(x); if (ArrayBuffer.isView(x)) return x.constructor.name + "[" + Array.prototype.join.call(x, ",") + "]"; if (Array.isArray(x)) return "list " + x.length + "[" + x.map(String).join(",") + "]"; return typeof x === "object" ? "object " + JSON.stringify(x) : String(x); }
function sums(xs, ys, out) { for (let i = 0; i < xs.length; i++) out[i] = xs[i] + ys[i]; return out; }
function totals(xs, ys, more, k) { let total = k & 3; for (let i = 0; i < xs.length; i++) { const v = xs[i] + ys[i]; total += v; total += more[i]; } return total; }
const byName = { sums, totals }, name = text => JSON.parse('"' + text + '"');
function attempt(title, run, ...beside) { let said; try { said = show(run()); } catch (error) { said = error.constructor.name; } console.log(title, said, "|", beside.map(show).join(" | ")); }
const makers = [
  ["floats", () => Float64Array.of(1.5, 2.5, 3.5, 4.5)], ["bytes", () => Uint8Array.of(1, 2, 3, 4)], ["shorts", () => Int16Array.of(-1, 2, -3, 4)], ["a list of fractions", () => [0.5, 1.5, 2.5, 3.5]], ["a list of whole numbers", () => [1, 2, 3, 4]],
  ["a list of texts", () => ["a", "b", "c", "d"]], ["a list with a hole", () => [1, , 3, 4]], ["a short list", () => [1]], ["an object", () => ({ 0: 1, 1: 2 })], ["nothing", () => undefined],
];
for (let round = 0; round < 2; round++)
  for (const [first, makeFirst] of makers.slice(0, 5))
    for (const [second, makeSecond] of makers)
      for (const [third, makeThird] of makers) {
        const out = makeThird();
        attempt(first + " + " + second + " > " + third, () => byName[name("sums")](makeFirst(), makeSecond(), out), out);
        attempt(first + " + " + second + " + " + third, () => byName[name("totals")](makeFirst(), makeSecond(), makeThird(), round));
      }
