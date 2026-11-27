function texts(n: number): string { const l = ["a", "b", "c"]; let t = ""; for (let i = 0; i < n; i++) for (const k of l) t += k; return t; }
function objects(n: number): number { const l = [{ x: 1 }, { x: 2 }]; let t = 0; for (let i = 0; i < n; i++) for (const k of l) t += k.x++; return t; }
function holes(n: number): string { const l = [1, , 3]; let t = ""; for (let i = 0; i < n; i++) for (const k of l) t += String(k); return t; }
function doubles(n: number): number { const l = [0.5, 1.5]; let t = 0; for (let i = 0; i < n; i++) for (const k of l) t += k; return t; }
function empty(n: number): number { const l: number[] = []; let t = 0; for (let i = 0; i < n; i++) for (const k of l) t += k; return t; }
console.log(texts(3), objects(3), holes(2), doubles(5), empty(4));
