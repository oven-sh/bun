function run(n: number): string { const l = [1, 2]; let t = 0; for (let i = 0; i < n; i++) { for (const k of l) t += k; l[i & 1] = i; } return t + " " + l.join(); }
function half(n: number): string { const l = [1, 2]; let t = 0; for (let i = 0; i < n; i++) { for (const k of l) t += k; if (i === 3) l[0] = 0.5; if (i === 5) (l as any)[1] = "x"; } return t + " " + l.join(); }
console.log(run(0), run(1), run(9), half(3), half(5), half(8));
