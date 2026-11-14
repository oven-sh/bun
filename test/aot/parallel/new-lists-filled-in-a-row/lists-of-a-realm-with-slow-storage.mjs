let reads = 0;
const parent = Object.create(Array.prototype);
Object.setPrototypeOf([], parent);
Object.defineProperty(parent, 1, { get() { reads++; return 9; }, set() { reads += 100; } });
function text(list) { let all = String(list.length); for (let i = 0; i < list.length; i++) all += "|" + (i in list ? String(list[i]) : "hole"); return all; }
let last = "";
for (let round = 0; round < 300; round++) last = text(new Array(5).fill(round)) + " " + text(Array.from({ length: 3 })) + " " + text(new Array(200).fill("t")).length;
console.log(last, reads);
