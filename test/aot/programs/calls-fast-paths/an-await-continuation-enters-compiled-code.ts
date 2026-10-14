// Resuming after an `await`: the microtask queue enters compiled code.
declare const console: any;
async function loop(n: number) { let s = 0; for (let i = 0; i < n; i++) { s += await i; } return s; }
loop(1_000_000).then((s: number) => console.log(s));
export {};
