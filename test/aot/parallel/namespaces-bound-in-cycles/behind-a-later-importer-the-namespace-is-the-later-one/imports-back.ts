import * as file from "./file.cjs";
class Tag { n = 1; m = 2; }
const unseen = (x: any): any => [x][JSON.parse("0")];
function namesOf(o: any): string { let names = ""; for (const name in o) names += name + "."; return names; }
function tell(tag: Tag): string { let work = 0; for (let i = 0; i < 2; i++) work = (work + tag.n + tag.m) | 0; return namesOf(file) + work; }
const real = new Tag(), liar = unseen({ n: 1, m: 2 });
const bound = unseen(file);
let warm = "";
for (let turn = 0; turn < 300; turn++) warm = tell(real);
console.log("in the cycle:", warm, "|", tell(liar));
(globalThis as any).later = (when: string) => console.log(when + ":", tell(real), "|", tell(liar), "| the object it was bound to:", file === bound);
