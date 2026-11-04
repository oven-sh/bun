function collect(n: number): string { const made: (() => string)[] = []; for (let i = 0, j = 0; i < n; i++, j++) { made.push(() => i + "/" + j); j += 1; } return made.map(f => f()).join(); }
function late(n: number): string { const made: (() => number)[] = []; for (let i = 0, total = 0; i < n; i++) { total += i; made.push(() => i * 100 + total); } return made.map(f => f()).join(); }
console.log(collect(4), late(4));
