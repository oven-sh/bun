const unseen = (x: any): any => [x][JSON.parse("0")];
const say = (value: unknown): string => typeof value + ":" + String(value);
interface Row { first: number; second: number; third: string }
function make(seed: number): Row { return { first: seed, second: seed + 1, third: "t" + seed }; }
const shelf: Row[] = [];
var __assign = function (this: any, ...all: any[]): any { __assign = Object.assign || function (t: any) { for (var s, i = 1, n = arguments.length; i < n; i++) { s = arguments[i]; for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p)) t[p] = s[p]; } return t; }; return __assign.apply(this, arguments as any); };
function copyOf(x: Row): Row { return __assign({}, x); }
function copyWith(x: Row, v: any): Row { return __assign(__assign({}, x), { second: v }); }
function read(x: Row): string { const e: unknown = x.first, f: unknown = x.second, g: unknown = x.third; return say(e) + say(f) + say(g) + Object.keys(x).join(); }
const runs: ((...all: any[]) => any)[] = [read, unseen(read)];
unseen(make(0));
let last = "";
for (let i = 0; i < 300; i++) last = runs[JSON.parse("0")](copyOf(make(i))) + runs[JSON.parse("0")](copyWith(make(i), i)) + runs[JSON.parse("0")](make(i));
console.log("warm", last);
const hurt = make(5); delete (hurt as any).second;
console.log("of a hurt one", runs[JSON.parse("0")](copyOf(hurt)), runs[JSON.parse("0")](copyWith(hurt, 9)), runs[JSON.parse("0")](copyWith(hurt, undefined)));
const last3 = make(6); delete (last3 as any).third;
console.log("of one without its last", runs[JSON.parse("0")](copyOf(last3)), runs[JSON.parse("0")](copyWith(last3, 9)));
console.log("undefined laid over", runs[JSON.parse("0")](copyWith(make(7), undefined)));
console.log("whole", runs[JSON.parse("0")](copyOf(make(8))));
export {};
