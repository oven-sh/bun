const said: unknown[] = [];
const show = (v: unknown) => (Object.is(v, -0) ? "-0" : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v));
function first(list: number[], wanted: number): number { for (const [i, x] of list.entries()) { if (x === wanted) return i; } return -1; }
function sums(list: number[]): number { let sum = 0; outer: for (const [i, x] of list.entries()) { for (const j of list.keys()) { if (j > i) continue outer; if (x > 90) break outer; sum += x * j; } } return sum; }
function throws(list: number[]): string { try { for (const [i, x] of list.entries()) { try { if (x === 3) throw new Error("at " + i); } finally { said.push("f" + i); } } } catch (error) { return (error as Error).message; } return "none"; }
for (let turn = 0; turn < 300; turn++) { said.length = 0; const list = [1, 2, 3, 4, 99, 5]; said.push(first(list, 4), first(list, 7), sums(list), throws(list), throws([1])); }
console.log(said.map(show).join(" "));
