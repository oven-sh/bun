// What is printed is what plain Bun prints.
const spin = turns => { let sum = 0; for (let turn = 0; turn < turns; turn++) sum = (sum + turn) | 0; return sum; };
let last;
for (let index = 0; index < 40000; index++) { spin(12000); last = new RegExp("r" + index); }
console.log(`SAID ${[last].map(it => it.source).join(" ")}`);
