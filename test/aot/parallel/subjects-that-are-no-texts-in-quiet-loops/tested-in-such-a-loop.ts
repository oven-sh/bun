// The same loop with test on a written RegExp. What is printed is what plain Bun prints.
// STATISTIC: StringOperandsGuardedInIterations >= 1
const unseen = (x: any): any => [x][JSON.parse("0")];
const told: string[] = [];
const lines: string[] = unseen(["a=1", "b", 42, { toString() { told.push("converted"); return "c=3"; } }, "d=4", null, "=", 1.5]);
function tested(): number { let n = 0; for (let i = 0; i < lines.length; i++) { if (/\w=\d/.test(lines[i])) n += 100; else n++; } return n; }
for (let round = 0; round < 3; round++) told.push("tested " + tested());
console.log(told.join("\n"));
