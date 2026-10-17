// A loop that awaits a call of an async function.
declare const console: any;
async function one(i: number) { return i; }
async function loop(n: number) { let s = 0; for (let i = 0; i < n; i++) { s += await one(i); } return s; }
loop(1_000_000).then((s: number) => console.log(s));
export {};
