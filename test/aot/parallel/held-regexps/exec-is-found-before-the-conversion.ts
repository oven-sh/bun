// exec is looked for before its subject is converted: an exec that the toString of the subject lays is found by the next call alone. What is printed is what plain Bun prints.
const unseen = (x: any): any => [x][JSON.parse("0")];
const told: string[] = [];
const held: any = /(\w)=(\d)/;
function read(subject: any): string { const m = held.exec(subject); return m ? m[1] + m[2] : "none"; }
const lays = { toString() { held.exec = () => null; return "x=1"; } };
for (let round = 0; round < 3; round++) { told.push("as made " + read("x=1") + " " + read("none") + " " + read(unseen(41))); told.push("laid in the conversion " + read(unseen(lays))); told.push("stays " + read("x=1")); delete held.exec; told.push("taken away " + read("x=1")); }
console.log(told.join("\n"));
