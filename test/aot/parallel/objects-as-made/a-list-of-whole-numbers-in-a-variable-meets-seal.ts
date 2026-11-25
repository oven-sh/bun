const marks: number[] = [3, 1, 4, 1, 5, 9, 2, 6];
Object.seal(marks);
function total(): number { let sum = 0; for (let at = 0; at < marks.length; at++) sum += marks[at]; return sum; }
function walked(): number { let sum = 0; for (const mark of marks) sum = sum * 3 + mark; return sum; }
function asked(wanted: number): string { return [marks.includes(wanted), marks.indexOf(wanted), marks.lastIndexOf(wanted), marks.at(-1), marks.join("-"), marks.slice(1, 3).length, [...marks].length].join(); }
function tried(deed: () => unknown): string { try { return String(deed()); } catch (error) { return (error as Error).constructor.name; } }
let all = "";
for (let round = 0; round < 4; round++) all += total() + "," + walked() + "," + asked(round) + ";";
all += tried(() => marks.push(7)) + "," + tried(() => marks.pop()) + "," + tried(() => { "use strict"; marks[0] = 8; return marks[0]; }) + "," + tried(() => marks.sort()[0]) + "," + tried(() => marks.length);
console.log(all);
