// Typed: methods of a class below Map and below Set store, delete, list, spread, freeze and compare `this`.
class Bag extends Map<string, number> {
  total(): number { let sum = 0; for (const value of this.values()) sum += value; return sum; }
  mark(): this { (this as any).marked = true; return this; }
  unmark(): boolean { return delete (this as any).marked; }
  names(): string { return Object.keys(this).join() + "|" + JSON.stringify(this) + "|" + ("marked" in this) + "|" + Object.isFrozen(this); }
  copy(): object { return { ...this }; }
  same(other: Bag): boolean { return this === other; }
  grow(key: string): number { this.set(key, (this.get(key) ?? 0) + 1); return this.size; }
}
class Tags extends Set<string> { first(): string | undefined { for (const tag of this) return tag; return undefined; } both(other: Tags): number { let n = 0; for (const tag of other) if (this.has(tag)) n++; return n; } }
const lines: (string | number | boolean)[] = [];
const bag = new Bag([["a", 1], ["b", 2]]);
let sum = 0; for (let i = 0; i < 400; i++) sum += bag.total() + bag.grow(i & 1 ? "a" : "c"); lines.push(sum, bag.names());
lines.push(bag.mark().names(), JSON.stringify(bag.copy()), bag.total(), bag.unmark(), bag.names(), bag.same(bag), bag.same(new Bag()));
for (let i = 0; i < 100; i++) sum += bag.total(); lines.push(sum);
Object.freeze(bag); lines.push(bag.names(), bag.grow("z"));
try { bag.mark(); lines.push("marked"); } catch (error) { lines.push((error as Error).constructor.name); }
const tags = new Tags(["x", "y"]), more = new Tags(["y", "z"]);
let hits = 0; for (let i = 0; i < 300; i++) hits += tags.both(more) + (tags.first() === "x" ? 1 : 0); lines.push(hits);
function takes(b: Bag): number { return b.total(); }
lines.push(takes(new Bag([["q", 7]])), takes(Object.setPrototypeOf(new Map([["q", 8]]), Bag.prototype)));
try { lines.push(takes(Object.create(Bag.prototype))); } catch (error) { lines.push((error as Error).constructor.name); }
console.log(lines.join("\n"));
