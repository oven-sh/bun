// Fields that a later cast to a subtype adds to an object can be observed as missing until they are stored.
const show = (what: string, o: object) => console.log(what, JSON.stringify(Object.keys(o)), JSON.stringify(o))
const read = (o: any, name: string) => o[name]
interface Sym { flags: number; name: string }
interface Transient extends Sym { links: { check: number }; depth: number }
function SymCtor(this: Sym, flags: number, name: string) { this.flags = flags; this.name = name }
const Sym = SymCtor as unknown as new (flags: number, name: string) => Sym
function transient(flags: number, name: string): Transient {
  const made = new Sym(flags, name) as Transient
  made.links = { check: flags * 2 }
  made.depth = 1
  return made
}
show("fresh", transient(1, "a"))
// The cast comes long after the allocation, and the added fields are seen absent.
const kept: Sym[] = [new Sym(2, "b"), transient(3, "c")]
for (const sym of kept) {
  const late = sym as Transient
  console.log(late.flags, late.name, "depth" in late, read(late, "depth"), read(late, "links")?.check, JSON.stringify(Object.keys(late)))
}
const late = kept[0] as Transient
late.depth = 5; show("late", late); console.log(late.depth + late.flags)
// A literal that becomes more.
interface Range { pos: number; end: number }
interface Item extends Range { kind: number; flags: number }
function ItemCtor(this: Item, kind: number, pos: number, end: number) { this.pos = pos; this.end = end; this.kind = kind; this.flags = 0 }
const Item = ItemCtor as unknown as new (kind: number, pos: number, end: number) => Item
const ranges: Range[] = [{ pos: 1, end: 2 }, new Item(7, 3, 4)]
for (const range of ranges) {
  const item = range as Item
  console.log(item.pos, item.end, read(item, "kind"), "kind" in item, read(item, "flags"), JSON.stringify(Object.keys(item)))
}
function setRange<T extends Range>(range: T, from: Range | undefined): T { if (from) { range.pos = from.pos; range.end = from.end } return range }
const moved = setRange(new Item(8, 0, 0), ranges[0]); show("moved", moved); console.log(moved.kind + moved.flags + moved.pos + moved.end)
