// A chain of `.then(callback)`.
declare const console: any;
let s = 0; let p: Promise<number> = Promise.resolve(0);
for (let i = 0; i < 1_000_000; i++) { p = p.then((v: number) => { s += v; return i; }); }
p.then(() => console.log(s));
export {};
