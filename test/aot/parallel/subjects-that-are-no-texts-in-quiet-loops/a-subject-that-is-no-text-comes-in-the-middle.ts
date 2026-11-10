// A loop that only computes matches the elements of a list that is said to hold texts; in the middle come a number, null, a list, and objects whose toString tells that it ran. What is printed is what plain Bun prints.
// STATISTIC: StringOperandsGuardedInIterations >= 1
const unseen = (x: any): any => [x][JSON.parse("0")];
const told: string[] = [];
const lines: string[] = unseen(["a=1", "b=2", 42, "c=3", null, ["dd=44"], { toString() { told.push("converted once"); return "eee=555"; } }, "f=6", undefined, { toString() { told.push("converted again"); return "none"; } }, "g=7"]);
function read(): number { let n = 0; for (let i = 0; i < lines.length; i++) { const m = /^(\w+)=(.*)$/.exec(lines[i]); if (m) n += m[1].length * 100 + m[2].length; else n += 10000; } return n; }
for (let round = 0; round < 3; round++) told.push("sum " + read());
console.log(told.join("\n"));
