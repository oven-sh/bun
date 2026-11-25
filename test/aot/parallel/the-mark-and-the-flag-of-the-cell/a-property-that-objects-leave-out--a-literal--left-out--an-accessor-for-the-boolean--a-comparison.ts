const enum Flags { None = 0, A = 1, B = 2, C = 4 }
const opaque = <T>(value: T): T => (process.argv.length > 99 ? (undefined as any) : value);
type Opt = { flag?: boolean; n?: Flags; list: number[] };
function read(x: Opt): string { return x.flag === true ? "yes" : String(x.flag); }
(globalThis as any).read = read;
const many: Opt[] = []; for (let i = 0; i < 8; i++) many.push(i & 1 ? ({ list: [i] } as Opt) : ({ list: [i], flag: true, n: Flags.B } as Opt));
(globalThis as any).many = many;
let before = ""; for (let i = 0; i < 300; i++) before = read(many[i & 7]);
const i = 9; const odd: any = opaque(({ list: [i] } as Opt)); (function (o: any) { Object.defineProperty(o, "flag", { get() { return "got"; }, configurable: true, enumerable: true }); })(odd);
const answer = read(odd);
let behind = ""; for (let i = 0; i < 300; i++) behind = read(many[i & 7]) + read(odd);
console.log(before, "|", answer, "|", behind);
export {};
