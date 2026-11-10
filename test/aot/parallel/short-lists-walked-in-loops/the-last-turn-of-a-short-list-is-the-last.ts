// STATISTIC: RecordedLengthLoopsFullyUnrolled >= 1
const seen: string[] = [];
function order(n: number): string { seen.length = 0; for (let i = 0; i < n; i++) { seen.push("in " + i); for (const x of [1, 2, 3]) seen.push(i + ":" + x); seen.push("out " + i); } return seen.join(); }
function last(n: number): number { let kept = -1; for (let i = 0; i < n; i++) for (const x of [4, 5, 6]) kept = x * 10 + i; return kept; }
function behind(n: number): string { let said = ""; for (let i = 0; i < n; i++) { let count = 0; for (const x of [1, 2]) count += x; said += count + (i + 1 < n ? "," : "."); } return said; }
function positions(n: number): string { const l = [9, 8, 7]; let said = ""; for (let i = 0; i < n; i++) { let at = 0; for (const x of l) { said += at + "=" + x + " "; at++; } said += "(" + at + " of " + l.length + ") "; } return said; }
console.log(order(2)); console.log(last(0), last(1), last(3)); console.log(behind(3)); console.log(positions(2));
