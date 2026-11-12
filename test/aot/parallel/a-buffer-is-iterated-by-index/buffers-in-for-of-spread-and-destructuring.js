function sum(b) { let s = 0; for (const x of b) s = (s + x) | 0; return s; }
function firstTwo(b) { const [one, two] = b; return one + ":" + two; }
const text = Buffer.from("hello"), filled = Buffer.alloc(4096, 7), part = Buffer.allocUnsafe(8).fill(1).subarray(2, 5);
let told = "";
for (let round = 0; round < 4; round++) told += sum(filled) + " ";
console.log(told, sum(text), sum(Buffer.alloc(0)), sum(part), [...text].join(), firstTwo(text), firstTwo(Buffer.alloc(1, 9)), Math.max(...part), sum(new Uint8Array(3).fill(2)));
