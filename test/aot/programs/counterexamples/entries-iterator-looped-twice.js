// An `entries()` iterator that a loop has exhausted yields nothing the second time.
const e = [7].entries(); let n = 0;
for (let r = 0; r < 2; r++) for (const [i] of e) n++;
console.log(n);
