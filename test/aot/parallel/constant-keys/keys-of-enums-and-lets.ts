// Keys in brackets that are constant strings: members of enums, variables of `let` without another store, strings behind casts and templates.
enum Name { Count = "count", Size = "size", Proto = "__proto__", First = "0", Made = "constructor" }
const enum Short { Count = "count", Sum = "a" + "b" }
namespace Space { export enum Inner { Deep = "deep" } export let L = "spaced"; }
let key = "count";
let other: string = "size";
let moved = "before";
function show(v: any): string {
  if (typeof v === "function") return "fn:" + v.name;
  if (v === null || typeof v !== "object") return String(v);
  return "{" + Reflect.ownKeys(v).map(k => String(k) + ":" + show(v[k as string])).join() + "}" + (Object.getPrototypeOf(v) === Object.prototype ? "" : "^" + Object.getOwnPropertyNames(Object.getPrototypeOf(v)).join("."));
}
function said(body: () => unknown): void { const all: string[] = []; for (let i = 0; i < 3; i++) { try { all.push(show(body())); } catch (error) { all.push((error as Error).name); } } console.log(all.join(" ")); }
const record: Record<string, number> = { [Name.Count]: 0, [Name.Size]: 2 };
said(() => { for (let i = 0; i < 5; i++) { record[Name.Count]! += i; record[Short.Count]!++; record[key]! -= 1; } return record; });
said(() => ({ [Name.Proto]: 1, [Name.First]: 2, [Space.Inner.Deep]: 3, [Space.L]: 4, [Short.Sum]: () => 5 }));
said(() => ({ [Name.Count]() { return 1; }, get [Name.Size]() { return 2; }, [key + ""]: class { } }));
said(() => { class Q { [Name.Count] = 1; static [Name.Size] = 2; [Name.First]() { return 3; } up() { (this as any)[Name.Count] += 2; return (this as any)[Name.Count]; } } const q = new Q(); return [q.up(), q.up(), show(q), (Q as any)[Name.Size], q[Name.First]()]; });
said(() => { let local = "count"; class Q { [local] = 1; add(by: number) { (this as any)[local] += by; return this; } } return new Q().add(2).add(3); });
said(() => { const o: any = {}; const read = () => o[late], write = () => { o[late] = (o[late] ?? 0) + 1; }, make = () => ({ [late]: 1 }); const got: string[] = []; for (const f of [read, write, make]) { try { f(); got.push("ran"); } catch (error) { got.push((error as Error).name); } } let late = "late"; write(); write(); return [...got, read(), show(o), show(make())]; });
said(() => { const o: any = {}; const all: (() => number)[] = []; for (let i = 0; i < 3; i++) { let name = "n"; o[name] = i; all.push(() => o[name]); } return all.map(f => f()); });
said(() => { const o: any = { before: 1, after: 2 }; const first = o[moved]; moved = moved === "before" ? "after" : "before"; return [first, o[moved]]; });
said(() => { switch (Number(1)) { case 2: let dead = "count"; default: const read = () => record[dead]; return read(); } });
said(() => { const { [Name.Size]: size, [other]: again, ...rest } = { size: 1, count: 2, left: 3 } as any; return [size, again, show(rest)]; });
said(() => { const o: any = { count: 1 }; return [Name.Count in o, delete o[Name.Count], key in o, o?.[Name.Made] === Object, o[Name.Proto] === Object.prototype]; });
said(() => (JSON.parse("null") as any)[Name.Count]);
said(() => { (JSON.parse("null") as any)[Name.Count] += said; });
said(() => ({ count: 1 } as any)[Name.Size]());
said(() => { class R { [Name.Count]() { return 1; } } class Q extends R { [Name.Count]() { return super[Name.Count]() + 1; } } return new Q()[Name.Count](); });
