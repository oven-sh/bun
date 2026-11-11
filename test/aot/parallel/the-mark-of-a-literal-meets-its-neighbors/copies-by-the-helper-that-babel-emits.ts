const unseen = (x: any): any => [x][JSON.parse("0")];
const say = (value: unknown): string => typeof value + ":" + String(value);
interface Row { first: number; second: number; third: string }
function make(seed: number): Row { return { first: seed, second: seed + 1, third: "t" + seed }; }
const shelf: Row[] = [];
function ownKeys(e: any, r?: any) { var t = Object.keys(e); if (Object.getOwnPropertySymbols) { var o = Object.getOwnPropertySymbols(e); r && (o = o.filter(function (r) { return Object.getOwnPropertyDescriptor(e, r)!.enumerable; })), t.push.apply(t, o as any); } return t; }
function _defineProperty(e: any, r: any, t: any) { return r in e ? Object.defineProperty(e, r, { value: t, enumerable: !0, configurable: !0, writable: !0 }) : e[r] = t, e; }
function _objectSpread(e: any, ...rest: any[]) { for (var r = 1; r < arguments.length; r++) { var t = null != arguments[r] ? arguments[r] : {}; r % 2 ? ownKeys(Object(t), !0).forEach(function (r) { _defineProperty(e, r, t[r]); }) : Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)); } return e; }
function copyOf(x: Row): Row { return _objectSpread({}, x); }
function copyWith(x: Row, v: any): Row { return _objectSpread(_objectSpread({}, x), {}, { second: v }); }
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
