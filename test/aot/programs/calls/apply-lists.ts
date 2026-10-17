// Every kind of argument list that `apply` accepts, and everything it rejects.
declare const console: any;
const log: any[] = [];
function attempt(what: string, run: () => any) { try { log.push(what + ": " + String(run())); } catch (e: any) { log.push(what + " throws " + e.constructor.name); } }
const show: any = function (this: any, ...a: any[]) { return a.length + " [" + a.map(String).join(",") + "] " + String(this); };
const three: any = function (this: any, a: any, b: any, c: any) { return String(a) + "|" + String(b) + "|" + String(c) + "|" + arguments.length; };
const holes: any[] = [1, , 3];
const long: any[] = []; for (let i = 0; i < 20; i++) long.push(i);
const grown: any[] = [1]; grown.length = 3;
class Sub extends Array<any> {}
const sub = new Sub(); sub.push(7, 8);
const withProperty: any = [1, 2]; withProperty.extra = 1;
const frozen = Object.freeze([1, 2]);
const getter = { get length() { log.push("length read"); return 2; }, get 0() { log.push("0 read"); return "a"; }, 1: "b" };
const lists: [string, any][] = [
  ["empty", []], ["one", [1]], ["ints", [1, 2, 3]], ["doubles", [1.5, 2.5]], ["mixed", [1, "a", null, undefined, {}]], ["eight", [1, 2, 3, 4, 5, 6, 7, 8]],
  ["nine", [1, 2, 3, 4, 5, 6, 7, 8, 9]], ["five", [1, 2, 3, 4, 5]], ["long", long], ["holes", holes], ["grown", grown], ["subclass", sub], ["property", withProperty],
  ["frozen", frozen], ["undefined", undefined], ["null", null], ["array-like", { length: 2, 0: "x", 1: "y" }], ["getter", getter], ["typed array", new Uint8Array([1, 2])],
  ["string object", new String("ab")], ["number", 1], ["string", "ab"], ["boolean", true], ["symbol", Symbol.iterator], ["function", function (a: any, b: any) {}],
  ["negative length", { length: -1 }], ["no length", {}],
];
for (const f of [show, three, Math.max]) {
  for (const [name, list] of lists) attempt(name, () => f.apply("t", list));
}
for (const [name, list] of lists) { if (Array.isArray(list) && name !== "subclass") attempt("spread " + name, () => show(...list)); }
// The callee changes the list while it runs.
const changing: any[] = [1, 2];
log.push((function (this: any, a: any, b: any) { changing.length = 0; return a + b; }).apply(null, changing as any), changing.length);
console.log(log.join("\n"));
export {};
