const veil = value => JSON.parse("0", () => value);
const said = [];
// The list that the push fills is also what the other name holds: laid over in front of the inner loop, through a veil, through an object, through a closure; so the "other" list grows under the reads.
function sameByStore(n) { let row = [0, 1, 2]; const out = []; for (let i = 1; i <= 3; i++) { const next = [i]; row = next; for (let j = 1; j <= n; j++) next.push(Math.min(row[j - 1] + 1, next[j - 1] + 2, 99)); out.push(next.join(), row.length); } return out.join(";"); }
function sameByVeil(n) { const out = []; for (let i = 1; i <= 3; i++) { const next = [i]; const row = veil(next); for (let j = 1; j <= n; j++) next.push(Math.min(row[j - 1] + 1, next[j - 1] + 2, row.length + 50)); out.push(next.join(), row.length); } return out.join(";"); }
function sameByHolder(n) { const out = []; for (let i = 1; i <= 3; i++) { const next = [i]; const holder = { row: next }; for (let j = 1; j <= n; j++) next.push(Math.min(holder.row[j - 1] + 1, next[j - 1] + 2, 99)); out.push(next.join(), holder.row.length); } return out.join(";"); }
function readAhead(n) { let row = [5, 6, 7, 8, 9, 10, 11, 12]; const out = []; for (let i = 1; i <= 3; i++) { const next = [i]; if (i === 2) row = next; for (let j = 1; j <= n; j++) next.push(Math.min((row[j] ?? 40) + 1, next[j - 1] + 3, 99)); out.push(next.join()); row = next; } return out.join(";"); }
function veiledTexts(n) { const out = []; for (let i = 1; i <= 3; i++) { const next = [i]; const seen = veil(next); for (let j = 1; j <= n; j++) { if (j === 3) seen.push("text"); next.push(Math.min(next[j - 1] + 1, 99)); } out.push(next.join(), seen.length); } return out.join(";"); }
const table = { sameByStore, sameByVeil, sameByHolder, readAhead, veiledTexts };
for (let turn = 0; turn < 3; turn++) for (const name of JSON.parse('["sameByStore","sameByVeil","sameByHolder","readAhead","veiledTexts"]')) for (const n of [0, 1, 5, 30]) said.push(table[name](n));
console.log(said.join(" | "));
