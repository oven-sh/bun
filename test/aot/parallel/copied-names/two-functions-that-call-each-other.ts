function outer(n: number): string { const log: string[] = []; even(n); return log.join(); function even(k: number): void { log.push("e" + k); if (k) odd(k - 1); } function odd(k: number): void { log.push("o" + k); if (k) even(k - 1); } }
console.log(outer(3), outer(0));
