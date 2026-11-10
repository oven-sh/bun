// STATISTIC: CopiesThatAreDefinitionsOneByOne >= 3
// `{ ...first, ...second }`, `{ ...this.fields, ...fields }` in a loop: the second copy meets an object that is no literal in sight: where the own keys of its source are known it is their definitions one by one.
// Each kind of source and of target answers as written: the keys, their order, their values, and what runs on the way.
const log: string[] = [];
function show(o: any): string { return Reflect.ownKeys(o).map(k => String(k) + "=" + String(Object.getOwnPropertyDescriptor(o, k)!.get ? "getter" : o[k])).join(","); }
type More = { request: number; user: string };
const sym = Symbol("s");
class Fields { request = 7; user = "c"; }
const hidden: any = { request: 8, user: "h" }; Object.defineProperty(hidden, "user", { enumerable: false });
const watched: any = { get request() { log.push("get"); return 9; }, user: "w" };
const grown: any = { request: 10, user: "g" }; grown.extra = "x";
const turned: any = { user: "t", request: 11 };
const marked: any = { request: 12, user: "m", [sym]: "sym" };
const indexed: any = { request: 13, user: "i", 1: "one" };
const proto: any = JSON.parse('{"request":14,"user":"p","__proto__":{"evil":1}}');
const shrunk: any = { request: 15, user: "s" }; delete shrunk.user;
const sources: any[] = [{ request: 1, user: "a" }, { request: 2, user: "b" }, new Fields(), hidden, watched, grown, turned, marked, indexed, proto, shrunk, null, undefined, 5, "ab", [3, 4], new Proxy({ request: 16, user: "x" }, {}), Object.freeze({ request: 17, user: "f" }), { request: 18, user: "z" }];
class Logger { constructor(public fields: Record<string, unknown>) { } child(fields: any) { return new Logger({ ...this.fields, ...fields }); } }
const root = new Logger({ app: "a", pid: 1 });
const overlapping = new Logger({ user: "root", app: "a" });
function two(first: any, second: More) { return { ...first, ...second }; }
function behindAccessor(second: More) { return { get request() { return -1; }, tail: 0, ...({} as any), ...second }; }
function three(first: any, second: More, third: More) { return { ...first, ...second, ...third, last: 1 }; }
const lines: string[] = [];
for (let round = 0; round < 2; round++) {
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    lines.push([i, show(root.child(s).fields), show(overlapping.child(s).fields), show(two({ z: 0 }, s)), show(behindAccessor(s)), show(three({ z: 0 }, s, sources[(i + 1) % 2]))].join(" | "));
  }
}
console.log(lines.join("\n"));
console.log(log.length);
