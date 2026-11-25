type Holder = { b: string };
function make(): Holder { const made: Holder = { b: "y" }; Object.defineProperty(made, "taker", { set(v: any) { v.push("text"); } }); return made; }
function run(i: number): any { const list: number[] = [i, i + 1]; const holder: any = make(); holder.taker = list; return list[list.length - 1]; }
let got: any; for (let i = 0; i < 300; i++) got = run(i);
console.log(typeof got, typeof got === "number", got === "text");
