const unseen = (x: any): any => [x][JSON.parse("0")];
const say = (value: unknown): string => typeof value + ":" + String(value);
interface Row { first: number; second: number; third: string }
function make(seed: number): Row { return { first: seed, second: seed + 1, third: "t" + seed }; }
function read(x: Row): string { const e: unknown = x.first, f: unknown = x.second, g: unknown = x.third; return say(e) + say(f) + say(g); }
function stripByKey(o: any, k: string): boolean { return delete o[k]; }
const through: (f: unknown, o: unknown, k: string) => boolean = new Function("f", "o", "k", "return f(o, k)") as any;
const runs: ((...all: any[]) => any)[] = [read, unseen(read)];
unseen(make(0));
let last = "";
for (let i = 0; i < 300; i++) last = runs[JSON.parse("0")](unseen(make(i)));
console.log("warm", last);
let text = "";
for (let i = 0; i < 60; i++) { const odd = unseen(make(i)); through(stripByKey, odd, JSON.parse('"second"')); text = runs[JSON.parse("0")](odd) + Object.keys(odd).join(); if (i % 20 === 0) console.log("hurt", i, text); }
console.log("hurt", text);
console.log("whole", runs[JSON.parse("0")](unseen(make(6))));
export {};
