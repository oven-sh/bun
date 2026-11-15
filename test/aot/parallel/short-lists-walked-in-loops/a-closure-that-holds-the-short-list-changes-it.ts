function run(n: number): string { const l = [1, 2]; const more = () => { l.push(l.length); }; let s = 0; for (let i = 0; i < n; i++) { for (const k of l) s += k; if (i % 4 === 1) more(); } return s + " " + l.join(); }
console.log(run(0), run(2), run(10));
