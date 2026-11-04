// a turn hands the growing text to a function of the program, which keeps it
const kept: string[] = [];
function keep(text: string) { kept[kept.length] = text; }
function grow(n: number) { let s = ""; for (let i = 0; i < n; i++) { s += "k" + i; keep(s); } return s; }
console.log(JSON.stringify(grow(0)), kept.length);
console.log(grow(1), kept.join("|"));
console.log(grow(5), kept.join("|"));
for (let turn = 0; turn < 50; turn++) grow(turn % 7);
console.log(kept.length, kept[kept.length - 1], typeof kept[3], kept[3].length, kept[3] + "!", kept[3] === "k0k1k2");
