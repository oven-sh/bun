// Native functions call compiled functions with every number of arguments, from inside and outside an entry into the VM, and through exceptions and a full stack.
const say = (name: string, run: () => unknown) => {
  try { console.log(name, String(run())); } catch (error) { console.log(name, "throws", (error as Error).name, (error as Error).message); }
};
// replace() passes the match, each group, the position and the text: from 3 arguments up.
for (let groups = 0; groups <= 9; groups++) {
  const pattern = new RegExp("(a)".repeat(groups) + "b");
  const text = "x" + "a".repeat(groups) + "by";
  say("groups " + groups, () => text.replace(pattern, (...args: unknown[]) => "[" + args.length + ":" + args.join("|") + "]"));
  say("named " + groups, () => text.replace(pattern, function (this: unknown, match: string, ...rest: unknown[]) { return String(this) + match.length + rest.length; }));
}
say("fewer parameters than arguments", () => "ab".replace(/(a)(b)/, (match: string) => match + "!"));
say("more parameters than arguments", () => "ab".replace(/a/, (a: string, b: unknown, c: unknown, d: unknown, e: unknown, f: unknown, g: unknown, h?: unknown) => [a, b, c, d, e, f, g, h].join()));
say("rest of none", () => [3, 1, 2].sort((...args: number[]) => args[0]! - args[1]!).join());
say("reviver", () => JSON.stringify(JSON.parse('{"a":[1,{"b":2}],"c":"d"}', function (this: unknown, key: string, value: unknown) { return typeof value === "number" ? value + key.length : value; })));
say("replacer", () => JSON.stringify({ a: 1, b: [2, { c: 3 }] }, (key, value) => (typeof value === "number" ? value * 2 + key.length : value)));
class Money { constructor(public cents: number) {} toJSON(key: string) { return key + this.cents; } }
say("toJSON", () => JSON.stringify({ a: new Money(1), b: [new Money(2)] }));
say("a function that throws", () => [1, 2].sort(() => { throw new RangeError("from the comparator"); }));
say("a function that throws, nested", () => "ab".replace(/a/, () => JSON.stringify([1], () => { throw new TypeError("from the replacer"); })));
say("caught inside", () => "ab".replace(/a/, () => { try { return JSON.parse("[1]", () => { throw new Error("inner"); }); } catch (error) { return (error as Error).message; } }));
let depth = 0;
const recurse = (): string => { depth++; return "a".replace(/a/, recurse); };
say("a full stack", () => recurse());
console.log("went deep", depth > 100);
say("after a full stack", () => [2, 1].sort((a, b) => a - b).join());
const bound = function (this: { base: number }, a: number, b: number) { return this.base + a + b; }.bind({ base: 1 }, 2);
say("bound", () => [1, 2].map(bound).join());
const finished: string[] = [];
setTimeout((a: number, b: number) => { finished.push("timer " + (a + b)); }, 0, 1, 2);
queueMicrotask(() => { finished.push("microtask"); });
process.nextTick((a: number) => { finished.push("tick " + a); }, 5);
await new Promise(resolve => setTimeout(resolve, 5));
console.log(finished.join());
