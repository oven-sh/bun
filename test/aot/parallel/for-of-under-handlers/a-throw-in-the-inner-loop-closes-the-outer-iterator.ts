// The inner loop's head lies under the handler that closes the outer iterator. Its step goes on two ways; a throw in its turn still closes the outer iterator, once, and at the right step.
// STATISTIC: StepsOfListsOnWaysApartUnderHandlers >= 1
const said: string[] = [];
function make(rows: number[][]): Iterable<number[]> {
  return { [Symbol.iterator]() { let i = 0; return { next() { said.push("next " + i); return i < rows.length ? { done: false, value: rows[i++] } : { done: true, value: undefined as any }; }, return() { said.push("return at " + i); return { done: true, value: undefined as any }; } }; } };
}
function sum(rows: Iterable<number[]>, stop: number): number { let s = 0; for (const r of rows) for (const v of r) { if (v === stop) throw new Error("stop " + s); s += v; } return s; }
const rows = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];
for (let k = 0; k < 30; k++) sum(make(rows), -1);
said.length = 0;
try { console.log(sum(make(rows), 5)); } catch (e) { console.log((e as Error).message); }
console.log(said.join(", "));
