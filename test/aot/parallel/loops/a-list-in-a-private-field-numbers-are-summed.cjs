// STATISTIC: LoopsBuiltTwice >= 1
'use strict';
const q = Number(process.argv[2] ?? 3);
class Box { #rows = JSON.parse('[' + Array.from({ length: 40 }, (_, i) => i + q + 0.5).join() + ']'); sum() { let s = 0; for (let i = 0; i < this.#rows.length; i++) s = s + this.#rows[i] * 2; return s; } }
const box = new Box(); let sum = 0; for (let t = 0; t < 40; t++) sum = (sum + box.sum()) % 1000003; console.log(sum);
