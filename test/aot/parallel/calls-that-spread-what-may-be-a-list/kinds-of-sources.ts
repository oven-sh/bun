// `f(...xs)` in a loop where nobody has shown xs to be a list: the ways part on whether it is a list as made. Each kind of source answers as written.
// STATISTIC: SpreadCallsSpecializedForArrays >= 3
function two(a: any, b: any) { return String(a) + "," + String(b); }
function none() { return "none"; }
function withDefault(a: any, b: any = "d") { return String(a) + "," + String(b); }
function counts(a: any) { return arguments.length + ":" + String(a); }
function rest(a: any, ...more: any[]) { return String(a) + "|" + more.join("+") + "|" + more.length; }
class Sub extends Array<any> {}
function* made() { yield "g1"; yield "g2"; yield "g3"; }
const holes: any[] = [1, , 3];
const named: any = [1, 2]; named.extra = "x";
const frozen: any[] = Object.freeze([7, 8]) as any;
const own: any = [1, 2]; own[Symbol.iterator] = function* () { yield "own1"; yield "own2"; };
const sub: any = Sub.from([4, 5]);
const args: any = (function (..._: any[]) { return arguments; })(9, 10);
const withGetter: any = [1, 2]; Object.defineProperty(withGetter, 1, { get() { return "got"; }, enumerable: true, configurable: true });
const sources: any[] = [[1, 2], [3], [], [4, 5, 6], holes, named, frozen, own, sub, args, withGetter, "ab", new Set(["s1", "s2"]), new Map([["k", "v"]]), made(), new Uint8Array([11, 12]), [undefined, null], [[1], [2]], [1.5, -0], ["t", 1n]];
const lines: string[] = [];
for (let i = 0; i < sources.length * 2; i++) {
  const xs = sources[i % sources.length];
  lines.push(i + " " + two(...(xs as [any, any])) + " " + none(...(xs as [])) + " " + withDefault(...(xs as [any])) + " " + counts(...(xs as [any])) + " " + rest(...(xs as [any])));
}
console.log(lines.join("\n"));
