function run(n: number): string { const l = [1, 2, 3]; let s = 0, t = 0; for (let i = 0; i < n; i++) for (const k of l) { s++; t += k; if (i === 2 && k === 1) l.length = 1; if (i === 4) l.pop(); } return s + " " + t + " " + l.join(); }
console.log(run(0), run(2), run(3), run(9));
