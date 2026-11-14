// A loop reads what nobody knows under an integer. What is neither an array nor a view has a version of the loop of its own.
// STATISTIC: LoopsVersionedForPlainObjects >= 2
const table = {}; for (let i = 0; i < 10; i++) table[i] = i * 2;
const doubles = {}; for (let i = 0; i < 10; i++) doubles[i] = i + 0.5;
const mixed = { 0: 1, 1: "x", 2: 2.5, 3: undefined, 5: null, 7: true };
const below = Object.create({ 1: 10, 4: 20 }); below[0] = 1; below[2] = 3;
const read = { get 1() { return calls++; }, 0: 5, 2: 6 };
const sparse = { 0: 1, 100000: 2, 9: 9 };
const frozen = Object.freeze({ 0: 1, 1: 2, 9: -0 });
let calls = 0;
function sum(t, turns) { let n = 0; for (let k = 0; k < turns; k++) { n += t[k % 10]; } return n; }
function least(t, turns) { let n = 1e9; for (let k = 0; k < turns; k++) { const v = t[k & 7]; if (v < n) n = v; } return n; }
const said = [];
const holders = [table, doubles, mixed, below, read, sparse, frozen, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [0.5, 1.5], new Uint8Array(12).fill(3), new Float32Array(10).fill(1.5), "0123456789", new Map([[0, 1]]), Object.create(null), () => 1, 5];
const text = v => Object.is(v, -0) ? "-0" : typeof v === "string" ? v.length + v.slice(0, 20) + v.slice(-20) : String(v);
for (let round = 0; round < 6; round++) {
  for (const holder of holders) { try { said.push(text(sum(holder, 57)), text(least(holder, 40))); } catch (error) { said.push(error.name); } }
  if (round === 1) table[3] = 0.25;
  if (round === 2) table[4] = "four";
  if (round === 3) delete table[5];
  if (round === 4) Object.defineProperty(table, 6, { get() { calls++; return 1; } });
}
console.log(calls, said.join(" "));
