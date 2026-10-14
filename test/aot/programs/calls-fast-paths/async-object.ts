// An async function that returns a user-defined object: the promise is fulfilled without looking up `then`.
declare const console: any;
interface Box { v: number; w: number }
async function one(i: number): Promise<Box> { return { v: i, w: 1 }; }
async function loop(n: number) { let s = 0; for (let i = 0; i < n; i++) { const b = await one(i); s += b.v + b.w; } return s; }
loop(1_000_000).then((s: number) => console.log(s));
export {};
