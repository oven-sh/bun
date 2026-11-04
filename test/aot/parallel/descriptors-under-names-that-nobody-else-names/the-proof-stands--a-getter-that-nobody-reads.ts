const debugging: boolean = (0, eval)("1 + 1 === 2");
function make(start: number) { let pos = start; const made = { next: () => pos++, peek: () => pos }; if (debugging) Object.defineProperty(made, "zzShownToNobody", { get: () => pos }); return made; }
const one = make(1);
let sum = 0;
for (let i = 0; i < 1000; i++) sum += one.next() + one.peek();
console.log(sum, Object.getOwnPropertyNames(one).length);
