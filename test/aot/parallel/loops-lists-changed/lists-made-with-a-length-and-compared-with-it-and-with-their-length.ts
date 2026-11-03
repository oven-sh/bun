// A list made with a length, in loops whose counter is compared with its length and with the number it was made with.
const out: string[] = [];
function both(n: number): number[] { const list = new Array(n); for (let k = 0; k < list.length && k < n; k++) list[k] = k; return list; }
function bothOther(n: number): number[] { const list = new Array(n); for (let k = 0; k < n && k < list.length; k++) list[k] = k; return list; }
function half(n: number): number[] { const list = new Array(n); for (let k = 0.5; k < n; k++) list[k | 0] = k; return list; }
function wide(n: number, m: number): number[] { const list = new Array(n); for (let k = m; k < n; k++) list[k] = k; return list; }
function down(n: number): number[] { const list = new Array(n); for (let k = n - 1; k >= 0; k--) list[k] = k; return list; }
function twice(n: number): number[] { const list = new Array(n); for (let k = 0; k < n; k += 2) list[k] = k; return list; }
for (const n of [0, 1, 3, 8]) out.push(JSON.stringify([both(n), bothOther(n), half(n), wide(n, 1), down(n), twice(n)]));
out.push(JSON.stringify(wide(3, 0.5))); out.push(JSON.stringify(wide(3, -1)));
function fill(n: number) { const list: any[] = new Array(n); for (let k = 0; k < list.length && k < n; k++) list[k] = k; return list.length; }
out.push(String(fill(4)));
function other(n: number) { const list: any[] = new Array(n); for (let k = 0; k < n && k < list.length; k++) list[k] = k + 0.5; return list; }
out.push(JSON.stringify(other(3)));
console.log(out.join("\n"));
