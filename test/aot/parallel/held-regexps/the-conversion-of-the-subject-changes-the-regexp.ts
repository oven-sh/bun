// The toString of the subject sets lastIndex, and compiles the RegExp anew: the match sees what it left. What is printed is what plain Bun prints.
const unseen = (x: any): any => [x][JSON.parse("0")];
const told: string[] = [];
const lines: string[] = unseen(["color=red", "size=", "=none", "plain", "", "wide=中文", "a=b=c", "UP=down", "x=1;y=2;z=3"]);
const held = /(\w)=(\d)/g;
function read(subject: any): string { const m = held.exec(subject); return (m ? [m[0], m[1], m[2], m.index].map(String).join("|") : "none") + "," + held.lastIndex + "," + held.source; }
const moves = { toString() { held.lastIndex = 4; return "x=1;y=2;z=3"; } };
const compiles = { toString() { held.compile("(z)=(\\d)(;)?", "g"); return "x=1;y=2;z=3"; } };
for (let round = 0; round < 3; round++) { held.lastIndex = 0; told.push(read("x=1;y=2;z=3"), read(unseen(moves)), read(unseen(moves))); }
told.push(read(unseen(compiles)), read("x=1;y=2;z=3"), read("z=9"));
console.log(told.join("\n"));
