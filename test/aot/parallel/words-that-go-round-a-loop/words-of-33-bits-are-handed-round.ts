function zero(xs: number[], n: number): string { let a = xs[0]!, b = 0; for (let i = 0; i < n; i++) { const t = (a + b) | 0; b = a; a = t; } return a + ":" + b; }
function twin(xs: number[], n: number): string { let a = xs[0]!, b = a; for (let i = 0; i < n; i++) { const t = (a + b) | 0; b = a; a = t; } return a + ":" + b; }
function three(xs: number[], n: number): string { let a = xs[0]!, b = xs[1]!, c = xs[2]!; for (let i = 0; i < n; i++) { const t = (a ^ b ^ c) | 0; c = b; b = a; a = t; } return a + ":" + b + ":" + c; }
function mixed(xs: number[], n: number): string { let a = xs[0]!, b = xs[1]!; for (let i = 0; i < n; i++) { const t = (a + b) | 0; b = a >>> 0; a = t; } return a + ":" + b; }
function middle(xs: number[], data: unknown[], n: number): string { let a = xs[0]!, b = xs[1]!, c = xs[2]!; for (let i = 0; i < n; i++) { const t = (a ^ (data[i] as number)) | 0; c = b; b = a; a = t; } return a + ":" + b + ":" + c; }
function mirror(xs: number[], n: number): string { let h = xs[0]!, r = 0; for (let i = 0; i < n; i++) { if (h < 0) r = (r + 1) | 0; h = (h ^ i) >>> 0; } return h + ":" + r; }
const w = JSON.parse("[4294967295,2147483648,1,-1,3000000000,5]") as number[];
const n = JSON.parse("[0,1,2]") as number[];
const data = JSON.parse('[1,"2",3]') as unknown[];
console.log("SAID " + [zero([w[0]!], n[1]!), zero([w[0]!], n[2]!), twin([w[0]!], n[1]!), three([w[0]!, w[1]!, w[2]!], n[2]!), mixed([w[0]!, w[3]!], n[2]!), middle([w[0]!, w[4]!, w[5]!], data, n[2]!), mirror([w[3]!], n[2]!)].join(" "));
