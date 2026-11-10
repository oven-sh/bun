// The conversion of a subject throws in the middle of such a loop; the caller catches it. What is printed is what plain Bun prints.
// STATISTIC: OperandsAskedForTextInQuietTurns >= 1
const unseen = (x: any): any => [x][JSON.parse("0")];
const told: string[] = [];
const lines: string[] = unseen(["a=1", "b=2", Symbol("s"), "c=3"]);
const other: string[] = unseen(["a=1", { toString() { told.push("about to throw"); throw new RangeError("no text"); } }, "c=3"]);
let turns = 0;
function read(list: string[]): number { let n = 0; for (let i = 0; i < list.length; i++) { const m = /^(\w+)=(.*)$/.exec(list[i]); if (m) n += m[1].length * 100 + m[2].length; else n += 10000; turns = i; } return n; }
for (let round = 0; round < 3; round++) for (const list of [lines, other]) { try { told.push("done " + read(list)); } catch (error) { told.push((error as Error).constructor.name + " behind turn " + turns); } }
console.log(told.join("\n"));
