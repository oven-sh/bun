const strip: (o: any, k: string) => void = [new Function("o", "k", "delete o[k]") as any][JSON.parse("0")];
const define: typeof Object.defineProperty = (Object as any)[JSON.parse('"defineProperty"')];
const freeze: typeof Object.freeze = (Object as any)[JSON.parse('"freeze"')];
const unseen = (x: any): any => [x][JSON.parse("0")];
const say = (value: unknown): string => typeof value + ":" + String(value);
interface Row { whole: number; part: number; big: bigint; call: (n: number) => number; text: string; flag: boolean; list: number[]; none: null; a7: number; a8: number; a9: number; a10: number }
function twice(n: number): number { return n * 2; }
function make(seed: number): Row { return { whole: seed, part: seed + 0.5, big: BigInt(seed), call: twice, text: "t" + seed, flag: seed > 2, list: [seed], none: null, a7: 7, a8: 8, a9: 9, a10: 10 }; }
function read(x: Row): string { const a: unknown = x.whole, b: unknown = x.part, c: unknown = x.big, d: unknown = x.call, e: unknown = x.text, f: unknown = x.flag, g: unknown = x.list, h: unknown = x.none, i: unknown = x.a10;
  return say(a) + say(b) + say(c) + say(typeof d === "function" ? (d as any)(2) : d) + say(e) + say(f) + say(g) + say(h) + say(i); }
const runs: ((...all: any[]) => any)[] = [read, unseen(read)];
unseen(make(0));
let last = "";
for (let i = 0; i < 300; i++) last = runs[JSON.parse("0")](unseen(make(i)));
console.log("warm", last);
const odd = unseen(make(5));
define(odd, "call", { get() { return "by a getter"; }, configurable: true, enumerable: true });
console.log("hurt", runs[JSON.parse("0")](odd), Object.keys(odd).join());
console.log("whole", runs[JSON.parse("0")](unseen(make(6))));
export {};
