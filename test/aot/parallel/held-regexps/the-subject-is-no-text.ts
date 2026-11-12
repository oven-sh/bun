// The subject is a number, null, undefined, a list, an object with toString, a symbol. What is printed is what plain Bun prints.
const unseen = (x: any): any => [x][JSON.parse("0")];
const told: string[] = [];
const lines: string[] = unseen(["color=red", "size=", "=none", "plain", "", "wide=中文", "a=b=c", "UP=down", "x=1;y=2;z=3"]);
const digits = /(\d+)|(ull)|(def)|(,)/;
function read(subject: any): string { try { const m = digits.exec(subject); return m ? [m[0], m[1], m[2], m[3], m[4], m.index, m.input, typeof m.input].map(String).join("|") : "none"; } catch (error) { return (error as Error).constructor.name; } }
for (let round = 0; round < 3; round++) for (const subject of unseen([12.5, null, undefined, [1, 2], { toString() { return "made 77"; } }, Symbol("s"), "text 5", true, 10n, { toString() { throw new RangeError("no"); } }])) told.push(read(subject));
console.log(told.join("\n"));
