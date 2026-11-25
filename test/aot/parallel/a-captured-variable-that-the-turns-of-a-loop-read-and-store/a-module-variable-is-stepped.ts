const n = (value: number) => Number(process.argv[8] ?? value);
let pos = 0; const text = "ab cd  ef".repeat(n(3)); const end = text.length;
function skip(stop: number): number { while (pos < end) { if (text.charCodeAt(pos) === stop) break; pos++; } return pos; }
console.log(skip(32), (pos = 3, skip(32)), (pos = n(2147483646), skip(1)), (pos = 0.5 as number, skip(32)), pos, (pos = -3, skip(98)), pos);
