// Loops that push: the list's storage is read in front of the loop, and an iteration whose list has grown runs again behind that read.
// STATISTIC: GrownListsRunIterationAgain >= 5
function evens(list) { const out = []; for (let i = 0; i < list.length; i++) if (!(list[i] & 1)) out.push(list[i]); return out; }
function halves(list) { const out = []; for (let i = 0; i < list.length; i++) if (list[i] > 1) out.push(list[i] * 0.5); return out; }
function merge(a, b) { const out = []; let i = 0, j = 0; while (i < a.length && j < b.length) out.push(a[i] < b[j] ? a[i++] : b[j++]); while (i < a.length) out.push(a[i++]); while (j < b.length) out.push(b[j++]); return out; }
function counted(list) { const out = [7]; let steps = 0; for (const x of list) { steps++; if (x !== 3) out.push(x + steps); } return [out, steps]; }
function ends(list) { const out = []; let sum = 0; for (let i = 0; i < list.length; i++) { if (list[i] & 1) sum += out.push(list[i]); sum += out.length; } return [out, sum]; }
function both(list) { const odd = [], even = []; for (let i = 0; i < list.length; i++) { if (list[i] & 1) odd.push(list[i]); else even.push(i); } return [odd, even]; }
function rows(list) { const out = []; for (let i = 0; i < 5; i++) { for (let k = 0; k < list.length; k++) if (list[k] > i) out.push(list[k] - i); if (i === 2) out.length = 1; } return out; }
function pops(list) { const out = []; for (let i = 0; i < list.length; i++) { out.push(list[i]); if (i % 5 === 4) out.pop(); } return out; }
function last(list) { const out = [1]; for (let i = 0; i < list.length; i++) if (list[i] !== 2) out.push(out[out.length - 1] + list[i]); return out; }
function self(list) { for (let i = 0, n = list.length; i < n; i++) if (list[i] & 1) list.push(list[i]); return list; }
function until(list) { const out = []; for (let i = 0; i < list.length; i++) { if (list[i] === 11) break; if (list[i] & 1) continue; out.push(list[i]); } return out; }
function captured(list) { const out = []; let n = 0; const tell = () => n; for (let i = 0; i < list.length; i++) { n += list[i]; if (list[i] & 1) out.push(n); } return [out, tell()]; }
function* stepped(list) { const out = []; for (let i = 0; i < list.length; i++) { if (list[i] & 1) out.push(list[i]); if (i % 50 === 7) yield out.length; } return out; }
function guarded(list) { const out = []; for (let i = 0; i < list.length; i++) { try { if (list[i] & 1) out.push(list[i]); } catch { out.push(-1); } } return out; }
const show = value => Array.isArray(value) ? "[" + value.length + ":" + value.slice(0, 5).map(show) + "," + value.reduce((sum, x) => typeof x === "number" ? (sum * 31 + x * 4) | 0 : sum + 1, 7) + "]" : Object.is(value, -0) ? "-0" : typeof value === "object" && value ? "{}" : String(value);
const drain = iterator => { const seen = []; for (;;) { const step = iterator.next(); seen.push(step.value); if (step.done) return seen; } };
const fills = [i => i * 7 % 13, i => i * 7 % 13 / 4, i => i % 9 === 8 ? "s" + i : i, i => i === 20 ? 2147483648 : i, i => i & 1 ? -0 : NaN, i => ({ i }), i => i === 30 ? undefined : i];
let digest = 0, cases = 0;
for (const size of [0, 1, 3, 4, 17, 18, 60, 700, 3000]) {
  for (let kind = 0; kind < fills.length; kind++) {
    const make = () => Array.from({ length: size }, (_, i) => fills[kind](i));
    for (const run of [evens, halves, list => merge(list, list.slice(0, 9)), counted, ends, both, rows, pops, last, self, until, captured, list => drain(stepped(list)), guarded]) {
      const line = show([run(make()), run(make())]);
      cases++;
      for (let i = 0; i < line.length; i++) digest = (digest * 31 + line.charCodeAt(i)) | 0;
      if (cases % 61 === 5) console.log(size, kind, line.slice(0, 160));
    }
  }
}
console.log(cases, digest);
