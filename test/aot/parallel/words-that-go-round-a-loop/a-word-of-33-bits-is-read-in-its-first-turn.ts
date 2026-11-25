function over(xs: number[], n: number): string { let a = xs[0]!, r = 0; for (let i = 0; i < n; i++) { if (a > 2147483647) r = (r + 1) | 0; a = (a + 1) | 0; } return a + ":" + r; }
function half(xs: number[], n: number): string { let a = xs[0]!, r = 0.5; for (let i = 0; i < n; i++) { r = r + a / 2; a = (a + 1) | 0; } return a + ":" + r; }
function rest(xs: number[], n: number): string { let a = xs[0]!, r = 1; for (let i = 0; i < n; i++) { r = a % 7; a = (a + 1) | 0; } return a + ":" + (Object.is(r, -0) ? "-0" : String(r)); }
function at(xs: number[], marks: string[], n: number): string { let a = xs[0]!, r: string | undefined = "none"; for (let i = 0; i < n; i++) { r = marks[a]; a = (a + 1) | 0; } return a + ":" + r; }
function told(xs: number[], n: number): string { let a = xs[0]!, s = ""; for (let i = 0; i < n; i++) { s = s + a + ";"; a = (a + 1) | 0; } return s; }
function plus(xs: number[], n: number): string { let a = xs[0]!, r = 0.25; for (let i = 0; i < n; i++) { r = r + a; a = (a + 1) | 0; } return a + ":" + r; }
function same(xs: number[], top: number, n: number): string { let a = xs[0]!, r = 0; for (let i = 0; i < n; i++) { if (a === top) r = (r + 1) | 0; a = (a + 1) | 0; } return a + ":" + r; }
function square(xs: number[], n: number): string { let a = xs[0]!, r = 0; for (let i = 0; i < n; i++) { r = a * a; a = (a + 1) | 0; } return a + ":" + r; }
function minus(xs: number[], n: number): string { let a = xs[0]!, r = 1; for (let i = 0; i < n; i++) { r = -a; a = (a + 1) | 0; } return a + ":" + (Object.is(r, -0) ? "-0" : String(r)); }
const w = JSON.parse("[4294967295,2147483648,-7,-8,-1,1,4294967294,0]") as number[];
const n = JSON.parse("[0,1,2,3]") as number[];
const marks = JSON.parse('["zero","one"]') as string[];
(marks as unknown as Record<string, string>)["4294967295"] = "top"; (marks as unknown as Record<string, string>)["-1"] = "neg";
console.log("SAID " + [over([w[0]!], n[3]!), half([w[0]!], n[2]!), rest([w[0]!], n[1]!), rest([w[1]!], n[1]!), rest([w[2]!], n[1]!), rest([w[3]!], n[1]!), at([w[0]!], marks, n[1]!), at([w[4]!], marks, n[1]!), at([w[5]!], marks, n[1]!), at([w[6]!], marks, n[1]!), told([w[0]!], n[2]!), plus([w[0]!], n[1]!), same([w[0]!], w[0]!, n[2]!), same([w[0]!], w[4]!, n[2]!), square([w[0]!], n[1]!), minus([w[7]!], n[1]!), minus([w[0]!], n[1]!)].join(" "));
