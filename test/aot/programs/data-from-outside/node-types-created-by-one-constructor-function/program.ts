const show = (what: string, o: object) => console.log(what, JSON.stringify(Object.keys(o)), JSON.stringify(o, (key, value) => (key === "parent" ? undefined : value)))
enum Kind { Unknown, Leaf, File }
enum Flags { None = 0, Seen = 1, All = -1 }

interface Base { kind: Kind; pos: number; end: number; flags: Flags; parent: Base }
interface Leaf extends Base { kind: Kind.Leaf; value: string }
interface File extends Base { kind: Kind.File; fileName: string; text: string; lines: number[] }
interface Source { fileName: string; text: string; skip?: (pos: number) => number }

function BaseCtor(this: Base, kind: Kind, pos: number, end: number) { this.pos = pos; this.end = end; this.kind = kind; this.flags = Flags.None; this.parent = undefined! }
function SourceCtor(this: Source, fileName: string, text: string, skip?: (pos: number) => number) { this.fileName = fileName; this.text = text; this.skip = skip || (pos => pos) }
const allocator = { getBase: () => BaseCtor as any, getSource: () => SourceCtor as any }
let BaseConstructor: new (kind: Kind, pos: number, end: number) => Base
let FileConstructor: new (kind: Kind, pos: number, end: number) => File
let SourceConstructor: new (fileName: string, text: string, skip?: (pos: number) => number) => Source
function start() { BaseConstructor = allocator.getBase(); FileConstructor = allocator.getBase(); SourceConstructor = allocator.getSource() }
start()

function makeLeaf(value: string, pos: number): Leaf { const leaf = new BaseConstructor(Kind.Leaf, pos, pos + value.length) as Leaf; leaf.value = value; return leaf }
function makeFile(fileName: string, text: string): File { const file = new FileConstructor(Kind.File, 0, text.length); file.fileName = fileName; file.text = text; file.lines = [0]; return file }
const makeSource = (fileName: string, text: string) => new SourceConstructor(fileName, text)
// A File flows to a place for a Source.
const describe = (source: Source) => source.fileName + ":" + source.text.length + ":" + (source.skip ? source.skip(3) : -1)
const width = (node: Base) => (node.kind === Kind.File ? 1000 : 0) + node.end - node.pos + (node.flags & Flags.Seen)

const file = makeFile("a.ts", "let x"), leaf = makeLeaf("let", 0), source = makeSource("a.map", "{}")
leaf.parent = file; leaf.flags |= Flags.Seen
show("file", file); show("leaf", leaf); show("source", source)
console.log(describe(file), describe(source), width(file), width(leaf), leaf.parent === file, file.parent)
let sum = 0
for (let i = 0; i < 5; i++) { const node = i & 1 ? makeLeaf("ab" + i, i) : makeFile("f" + i, "x".repeat(i)); sum += width(node) * (i + 1) + node.kind }
console.log("sum", sum)
console.log("kind" in file, "value" in file, Object.hasOwn(leaf, "flags"), "skip" in file)
// Not fresh: as by any store.
BaseCtor.call(leaf, Kind.Leaf, 7, 9); show("again", leaf)
SourceCtor.call(file, "b.ts", "yy"); show("as source", file); console.log(describe(file), width(file))

// `new` expects no particular callee.
interface P { o: number[]; a: number; b: number }
interface Q extends P { c: number }
interface Wide { o: number[]; a: number }
function PCtor(this: P, o: number[]) { this.o = o; this.a = 1; this.b = 2 }
function WideCtor(this: Wide, o: number[]) { this.o = o; this.a = 5 }
const widen = (wide: Wide) => wide.a + wide.o.length
const makers = [PCtor, WideCtor, PCtor] as unknown as (new (o: number[]) => Q)[]
for (const Maker of [makers[0], makers[2]]) { const q = new Maker([1]); q.c = 3; show("Q", q); console.log(widen(q), q.a + q.b + q.c) }

// Two functions for one type: what both store first.
interface R { o: number[]; x: number; y: number }
function R1(this: R, o: number[]) { this.o = o; this.x = 1; this.y = 2 }
function R2(this: R, o: number[], late: boolean) { this.o = o; this.x = 3; if (late) console.log("late", JSON.stringify(Object.keys(this)), "y" in this); this.y = 4 }
const RA = R1 as unknown as new (o: number[]) => R, RB = R2 as unknown as new (o: number[], late: boolean) => R
show("R", new RA([1])); show("R", new RB([2], true)); show("R", new RB([3], false))
