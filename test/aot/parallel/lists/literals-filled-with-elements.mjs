// Literals that a loop fills with the elements of a list of unknown kind: of every kind, changed on the way, read, popped, handed out and filled again behind.
const show = x => Object.is(x, -0) ? "-0" : Array.isArray(x) ? "[" + Array.from({ length: x.length }, (_, i) => i in x ? x[i] : "hole").map(show).join() + "]" : typeof x === "object" && x ? "{" + Object.keys(x).map(k => show(x[k])) + "}" : typeof x === "bigint" ? x + "n" : String(x);
const kept = [];
function filled(L) { const q = []; for (let i = 0; i < L.length; i++) q.push(L[i]); return q; }
function drained(L) { const q = []; for (let i = 0; i < L.length; i++) q.push(L[i]); let s = 0; while (q.length > 0) s += q.pop(); return [s, q]; }
function summed(L) { const q = []; let s = 0; for (let i = 0; i < L.length; i++) { s += L[i]; q.push(L[i]); } for (let i = 0; i < q.length; i++) s += q[i]; return [s, q]; }
function some(L) { const q = []; for (let i = 0; i < L.length; i++) if (i % 2) q.push(L[i]); return q; }
function started(L) { const q = [0.5]; for (let i = 0; i < L.length; i++) q.push(L[i]); return q; }
function stopped(L) { const q = []; for (let i = 0; i < L.length; i++) { q.push(L[i]); if (i === 3) break; } return q; }
function between(L) { const q = []; for (let i = 0; i < L.length; i++) { if (i === 2) q.push("two"); q.push(L[i]); } return q; }
function handed(L) { const q = []; for (let i = 0; i < L.length; i++) { if (i === 2) kept.push(q); q.push(L[i]); if (kept.length) kept[0].length = 2; } kept.length = 0; return q; }
function both(L) { const q = [], r = []; for (let i = 0; i < L.length; i++) { q.push(L[i]); r.push(i); } return [q, r]; }
function twice(L) { const q = []; for (let k = 0; k < 2; k++) for (let i = 0; i < L.length; i++) q.push(L[i]); return q; }
function down(L) { const q = []; for (let i = L.length - 1; i >= 0; i--) q.push(L[i]); return q; }
function bounded(L) { const q = []; let s = 0; for (let i = 0; i < L.length; i++) { q.push(L[i]); if (q.length > 2) s += q.pop(); } return [s, q]; }
function answered(L) { const q = []; let n = 0; for (let i = 0; i < L.length; i++) n = q.push(L[i]); return [n, q]; }
function thrown(L) { const q = []; try { for (let i = 0; i < L.length; i++) { if (i === 4) throw i; q.push(L[i]); } } catch (e) { q.push("c" + e); } return q; }
const inputs = [() => [5, 3, 8, 1, 9, 2], () => [1.5, 0.5, 2.5], () => [1, 2, 2.5, 3], () => [1, 2, 3, 4, "late"], () => [1.5, 2.5, 3.5, {}], () => [3, , 1], () => [1.5, , 2], () => ["b", "a"], () => [], () => [NaN, -0, 1], () => [undefined, null, true], () => Float64Array.from([3, 1.5]), () => new Uint8Array([1, 250]), () => "text", () => JSON.parse("[4,3,2]"), () => JSON.parse("[4.5,3]"), () => Object.freeze([1, 2, 3]), () => [1n, 2n], () => [{ v: 1 }, { v: 2 }], () => ({ length: 3, 0: 5, 1: "z" }), () => [2147483647, 2147483648], () => Array.from({ length: 40 }, (_, i) => i < 30 ? i : i / 3)];
for (let turn = 0; turn < 4; turn++)
  for (const input of inputs)
    for (const run of [filled, drained, summed, some, started, stopped, between, handed, both, twice, down, bounded, answered, thrown]) {
      let said;
      try { said = show(run(input())); } catch (e) { said = "!" + e.constructor.name; }
      console.log(run.name, said.slice(0, 140));
    }
