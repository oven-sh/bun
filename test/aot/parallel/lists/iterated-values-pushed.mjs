// for (const x of list) pushes x onto a list made in front of the loop: numbers, texts, objects, holes, lists that change while they are iterated.
// STATISTIC: StoresGrowingArrays >= 8
function unique(list) { const out = []; for (const x of list) if (!out.includes(x)) out.push(x); return out; }
function odd(list) { const out = []; for (const x of list) if (x & 1) out.push(x); return out; }
function moved(list) { const out = []; for (const x of list) out.push(x); return out; }
function twice(list) { const out = []; for (const x of list) if (x > 1) out.push(x * 2); return out; }
function others(list) { const out = []; for (const x of list) if (x !== 2) out.push(x); return out; }
function pairs(list) { const out = []; for (const x of list) for (const y of list) if (x < y && out.length < 99) out.push(x); return out; }
function growing(list) { const out = []; for (const x of list) { if (list.length < 30) list.push(x); out.push(x); } return out; }
function firsts(list) { const out = []; for (const [x] of list.map(x => [x])) if (out.indexOf(x) < 0) out.push(x); return out; }
function until(list) { const out = []; for (const x of list) { if (x === 7) break; if (x === 3) continue; out.push(x); } return out; }
function both(list) { const low = [], high = []; for (const x of list) (x < 4 ? low : high).push(x); return [low, high]; }
function* yielded(list) { const out = []; for (const x of list) { out.push(x); if (x === 2) yield out.length; } return out; }
// Lists of integers and of fractions alone.
function uniqueIntegers(list) { const out = []; for (const x of list) if (!out.includes(x)) out.push(x); return out; }
function oddIntegers(list) { const out = []; for (const x of list) if (x & 1) out.push(x); return out; }
function largeIntegers(list) { const out = [0]; for (const x of list) { if (x > 3) out.push(x); } return out; }
function lastIntegers(list) { const out = [1]; for (const x of list) out.push(out[out.length - 1] + x); return out; }
function largeFractions(list) { const out = []; for (const x of list) if (x > 0.75) out.push(x); return out; }
function otherFractions(list) { const out = [0.5]; for (const x of list) { if (x === 1.5) continue; out.push(x); if (out.length > 60) break; } return out; }
const show = value => Array.isArray(value) ? "[" + Array.from({ length: value.length }, (_, i) => i in value ? show(value[i]) : "_") + "]" : Object.is(value, -0) ? "-0" : typeof value === "object" && value ? "{" + Object.keys(value) + "}" : String(value);
const drain = iterator => { const seen = []; for (;;) { const step = iterator.next(); seen.push(step.value); if (step.done) return seen; } };
const inputs = [() => [], () => [1, 2, 2, 3, 1, 4], () => [0.5, 2, NaN, -0, NaN, 3, 0], () => [1, 2, , 3, , 7], () => ["a", "b", "a", 2], () => [1, 2, 3, "x", 4], () => [{ a: 1 }, null, undefined, 2n, 2n], () => [2147483647, 2147483648, -1, 5], () => Array.from({ length: 400 }, (_, i) => i * 7 % 91), () => Array.from({ length: 90 }, (_, i) => i / 8), () => new Set([3, 1, 3]), () => "text", () => new Float64Array([1.5, 2, 3])];
let digest = 0, cases = 0;
for (const make of inputs) {
  for (const run of [unique, odd, moved, twice, others, pairs, growing, firsts, until, both, list => drain(yielded(list))]) {
    let line = "";
    for (let turn = 0; turn < 2; turn++) {
      try { line += show(run(make())) + " "; } catch (error) { line += error.name + " "; }
    }
    cases++;
    for (let i = 0; i < line.length; i++) digest = (digest * 31 + line.charCodeAt(i)) | 0;
    if (cases % 9 === 4) console.log(run.name, line.slice(0, 150));
  }
}
const integers = [[], [1, 2, 2, 3, 1, 4], Array.from({ length: 90 }, (_, i) => i * 7 % 31)], fractions = [[], [0.5, 1.5, 1.5, 2.25], Array.from({ length: 90 }, (_, i) => i / 8)];
for (const list of integers) console.log(show([uniqueIntegers(list), oddIntegers(list), largeIntegers(list), lastIntegers(list)]).slice(0, 400));
for (const list of fractions) console.log(show([largeFractions(list), otherFractions(list)]).slice(0, 400));
console.log(cases, digest);
