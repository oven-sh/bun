// !((A || B) && C): only the truth of the sides is wanted: each side is evaluated once, in order, and no further than the language says
const order: string[] = [];
function take<T>(place: number, value: T): T { order.push(String(place)); return value; }
const values: any[] = [0, -0, NaN, 1, 0.5, "", "a", null, undefined, {}, [], 0n, 1n, true, false, Symbol.iterator, function () {}];
const out: string[] = [];
function ask(a: any, b: any, c: any): boolean { return !((take(1, a) || take(2, b)) && take(3, c)); }
function held(a: any, b: any, c: any): string { const answer = !((take(1, a) || take(2, b)) && take(3, c)); return typeof answer + answer; }
for (const a of values) for (const b of values) for (const c of [0, "x", null, {}]) { order.length = 0; const first = ask(a, b, c); const path = order.join(""); order.length = 0; out.push(first + path + held(a, b, c) + order.join("")); }
let sum = 0; for (const line of out) for (let i = 0; i < line.length; i++) sum = (sum * 31 + line.charCodeAt(i)) | 0;
console.log(out.length, sum, out.slice(0, 6).join(" "), out.slice(-6).join(" "));
