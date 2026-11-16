type Holder = { b: string };
let calls = 0;
function make(): Holder { const made: Holder = { b: "y" }; Object.defineProperty(made, "taker", { set(v: any) { v("text"); } }); return made; }
function run(i: number): any { let seen: any = i; const holder: any = make(); holder.taker = (x: any) => { seen = x; calls++; }; return seen; }
let got: any; for (let i = 0; i < 300; i++) got = run(i);
console.log(typeof got, typeof got === "number", got === "text", calls);
