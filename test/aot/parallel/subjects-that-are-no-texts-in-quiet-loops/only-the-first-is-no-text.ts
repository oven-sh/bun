// The very first subject is no text, and the last. What is printed is what plain Bun prints.
// STATISTIC: StringOperandsGuardedInIterations >= 1
const unseen = (x: any): any => [x][JSON.parse("0")];
const told: string[] = [];
const lines: string[] = unseen([{ toString() { told.push("first"); return "aa=1"; } }, "b=2", "c=3", { toString() { told.push("last"); return "dddd=4"; } }]);
function read(): number { let n = 0; for (let i = 0; i < lines.length; i++) { const m = /^(\w+)=(.*)$/.exec(lines[i]); if (m) n += m[1].length * 100 + m[2].length; else n += 10000; } return n; }
for (let round = 0; round < 3; round++) told.push("sum " + read());
console.log(told.join("\n"));
