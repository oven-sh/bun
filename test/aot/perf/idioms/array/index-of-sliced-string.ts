import { nextTurns } from "../host.ts";
let sink: unknown;
let text = "";
for (let i = 0; i < 64; i++) text += "name" + ((i * 37) & 63) + "x".repeat(i & 3) + " ";
const declared: string[] = [];
for (let start = 0; start < text.length; ) {
    const end = text.indexOf(" ", start);
    declared.push(text.slice(start, end));
    start = end + 1;
}
const asked: string[] = declared.map(name => (" " + name).slice(1));
function bench(n: number): number {
    let s = 0;
    for (let i = 0; i < n; i++) s = (s + declared.indexOf(asked[i & 63]!)) | 0;
    return s;
}
sink = [bench];
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check, typeof sink);
