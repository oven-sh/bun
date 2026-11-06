// One `in` site in evaluated text sees an object many times, and then the answer changes.
class Base { inherited = 1; method() {} }
class Item extends Base { whole: number = 1; text: string = "t"; flag: boolean = true; link: Item | null = null; maybe?: number; maybeText?: string; anything: unknown = undefined; }
function hide(value: unknown): any { return value; }
const testers = new Map<string, (o: unknown) => string>();
function has(name: string, o: unknown): string {
  let tester = testers.get(name);
  if (!tester) testers.set(name, tester = new Function("o", `let seen = ""; for (let i = 0; i < 6; i++) { const v = ${JSON.stringify(name)} in o ? "y" : "n"; if (seen[seen.length - 1] !== v) seen += v; } return seen;`) as (o: unknown) => string);
  try { return tester(o); } catch (e) { return "THROWN " + (e as Error).name; }
}
const keyed = new Function("o", "key", `let seen = ""; for (let i = 0; i < 6; i++) { const v = key in o ? "y" : "n"; if (seen[seen.length - 1] !== v) seen += v; } return seen;`) as (o: unknown, key: unknown) => string;
let line = 0;
function show(title: string, ...values: string[]) { console.log(String(++line).padStart(2, "0"), title + ":", values.join(" ")); }
const names = ["whole", "text", "flag", "link", "maybe", "maybeText", "anything", "inherited", "method", "missing", "toString", "constructor", "__proto__"];
{
  const item = new Item();
  show("as created", ...names.map(name => has(name, item)));
  item.maybe = undefined; item.maybeText = "";
  show("optional fields stored", has("maybe", item), has("maybeText", item));
  delete item.maybe; delete hide(item).whole; delete hide(item).link; delete hide(item).flag; delete hide(item).anything;
  show("deleted", ...names.map(name => has(name, item)));
  hide(item).whole = "other type"; hide(item).link = undefined; item.maybe = 1;
  show("stored again", ...names.map(name => has(name, item)));
}
{
  const item = new Item();
  show("absent", has("maybe", item), has("missing", item));
  hide(Base.prototype).missing = 1; hide(Item.prototype).maybe = 1;
  show("found above", has("maybe", item), has("missing", item));
  delete hide(Base.prototype).missing; delete hide(Item.prototype).maybe;
  show("gone above", has("maybe", item), has("missing", item));
  Object.setPrototypeOf(item, null);
  show("no prototype", ...names.map(name => has(name, item)));
  Object.setPrototypeOf(item, { missing: 1 });
  show("another prototype", ...names.map(name => has(name, item)));
}
{
  const item = new Item();
  hide(item).extra = 1; Object.defineProperty(item, "unseen", { value: 1 }); Object.defineProperty(item, "accessor", { get() { throw new Error("not run by in"); }, configurable: true });
  show("extra properties", has("extra", item), has("unseen", item), has("accessor", item), has("missing", item));
  delete hide(item).extra; delete hide(item).accessor;
  show("deleted", has("extra", item), has("unseen", item), has("accessor", item));
  Object.defineProperty(item, "whole", { get() { throw new Error("not run by in"); } });
  show("a field becomes an accessor", has("whole", item));
}
{
  const parsed = JSON.parse('{"whole":1,"maybe":null}'), literal = { whole: 1 }, empty = {}, dictionary: Record<string, number> = {};
  for (let i = 0; i < 100; i++) dictionary["k" + i] = i;
  for (let i = 0; i < 100; i += 2) delete dictionary["k" + i];
  show("ordinary objects", ...[parsed, literal, empty].map(o => has("whole", o) + has("maybe", o) + has("toString", o)), has("k0", dictionary), has("k1", dictionary), has("whole", dictionary));
  dictionary.k0 = 1; dictionary.whole = 1; delete parsed.whole; hide(empty).whole = 1;
  show("after changes", has("whole", parsed), has("whole", empty), has("k0", dictionary), has("whole", dictionary));
  const log: string[] = [];
  const proxy = new Proxy(new Item(), { has(target, key) { log.push(String(key)); return key === "missing" || key in target; } });
  show("a proxy", has("whole", proxy), has("missing", proxy), has("other", proxy), String(log.length));
  show("arrays, functions, a frozen object", has("length", []), has("whole", []), has("name", show), has("prototype", Item), has("prototype", () => 1), has("whole", Object.freeze(new Item())), has("maybe", Object.freeze(new Item())));
  show("no object", has("whole", 1), has("whole", "s"), has("whole", undefined), has("whole", null));
}
{
  const item = new Item(), sym = Symbol("s");
  hide(item)[sym] = 1; hide(item)[5] = 1;
  show("by a key", ...["whole", "maybe", "missing", "method", sym, Symbol.iterator, 5, "5", 6, "who" + "le".slice(0), { toString() { return "text"; } }].map(key => keyed(item, key)));
  delete hide(item).whole; delete hide(item)[sym]; delete hide(item)[5];
  show("after deletions", keyed(item, "whole"), keyed(item, sym), keyed(item, 5), keyed(item, "5"));
}
{
  const shapes: unknown[] = [new Item(), new Base(), { whole: 1 }, {}, Object.create(new Item()), []];
  let out = "";
  for (let round = 0; round < 3; round++) for (const shape of shapes) out += has("whole", shape);
  show("many receivers at one site", out);
}
