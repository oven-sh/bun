const unseen = (x: any): any => [x][JSON.parse("0")];
function change(l: number[], i: number) { if (i === 2) l.push(10); if (i === 4) l.shift(); if (i === 6) delete l[0]; }
function run(n: number, f: (l: number[], i: number) => void): string { const l = [1, 2]; let s = 0, t = 0; for (let i = 0; i < n; i++) { for (const k of l) { s++; t += k; } f(l, i); } return s + " " + t + " " + l.length; }
console.log(run(0, change), run(3, change), run(5, change), run(9, unseen(change)));
