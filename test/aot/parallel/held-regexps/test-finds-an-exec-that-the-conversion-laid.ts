// test looks for exec on the RegExp behind the conversion of its subject: the toString of the subject lays an exec of its own there. What is printed is what plain Bun prints.
const unseen = (x: any): any => [x][JSON.parse("0")];
const told: string[] = [];
const held: any = /(\w)=(\d)/;
function ask(subject: any): boolean { return held.test(subject); }
const lays = { toString() { held.exec = () => null; return "x=1"; } };
for (let round = 0; round < 3; round++) { told.push("as made " + ask("x=1") + " " + ask("none") + " " + ask(unseen(41))); told.push("laid in the conversion " + ask(unseen(lays))); told.push("stays " + ask("x=1")); delete held.exec; told.push("taken away " + ask("x=1")); }
console.log(told.join("\n"));
