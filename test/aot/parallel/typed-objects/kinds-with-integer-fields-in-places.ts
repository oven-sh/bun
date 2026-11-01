// A constructor function makes objects of many kinds. Each kind declares integer fields of its own, none, one, two or three of them, between fields that hold objects and strings,
// so an empty object of one kind differs from an empty object of another in more than its size. A field that nothing has stored is absent, whatever the kind.
const enum Kind { Unknown, Plain, Count, CountLate, Pair, PairApart, Triple, Text, Flagged, Wide }
interface Node { kind: Kind; pos: number; end: number; flags: number; id: number; parent: Node | undefined }
interface Plain extends Node { kind: Kind.Plain; child?: Node }
interface Count extends Node { kind: Kind.Count; count?: number; child?: Node }
interface CountLate extends Node { kind: Kind.CountLate; first?: Node; second?: Node; third?: Node; count?: number }
interface Pair extends Node { kind: Kind.Pair; low?: number; high?: number; child?: Node }
interface PairApart extends Node { kind: Kind.PairApart; low?: number; first?: Node; name?: string; second?: Node; high?: number }
interface Triple extends Node { kind: Kind.Triple; a?: number; child?: Node; b?: number; name?: string; c?: number }
interface Text extends Node { kind: Kind.Text; text?: string; length?: number }
interface Flagged extends Node { kind: Kind.Flagged; isOpen?: boolean; depth?: number; isLast?: boolean }
interface Wide extends Node { kind: Kind.Wide; f0?: Node; f1?: Node; f2?: Node; f3?: Node; f4?: Node; f5?: Node; f6?: Node; f7?: Node; f8?: Node; f9?: Node; last?: number }
interface NodeConstructor { new (kind: Kind, pos: number, end: number): Node }
function NodeObject(this: Node, kind: Kind, pos: number, end: number) { this.pos = pos; this.end = end; this.kind = kind; this.id = 0; this.flags = 0; this.parent = undefined }
const Maker = NodeObject as unknown as NodeConstructor
function make<T extends Node>(kind: T["kind"], pos: number): T { return new Maker(kind, pos, pos + 1) as T }

const integerFields = ["count", "low", "high", "a", "b", "c", "length", "depth", "last"]
const otherFields = ["child", "first", "second", "third", "name", "text", "isOpen", "isLast", "f0", "f9"]
function show(label: string, node: any) {
  const held = integerFields.concat(otherFields).filter(name => name in node || node[name] !== undefined || Object.hasOwn(node, name))
  console.log(label, Object.keys(node).join(), JSON.stringify(node), "holds:", held.join() || "nothing more")
}

const kinds = [Kind.Unknown, Kind.Plain, Kind.Count, Kind.CountLate, Kind.Pair, Kind.PairApart, Kind.Triple, Kind.Text, Kind.Flagged, Kind.Wide, 10 as Kind, -1 as Kind]
for (let round = 0; round < 3; round++) {
  for (const kind of kinds)
    show("empty " + kind, make<Node>(kind, round))
}

function fillCount(node: Count, value: number) { node.count = value; return node }
function fillLate(node: CountLate, value: number) { node.count = value; node.second = node; return node }
function fillPair(node: Pair, low: number, high: number) { node.high = high; node.low = low; return node }
function fillApart(node: PairApart, low: number, high: number) { node.low = low; node.name = "apart"; node.high = high; return node }
function fillTriple(node: Triple, value: number) { node.c = value; node.a = value + 1; return node }
function fillText(node: Text, text: string) { node.text = text; node.length = text.length; return node }
function fillFlagged(node: Flagged, depth: number) { node.isLast = false; node.depth = depth; return node }
function fillWide(node: Wide, value: number) { node.last = value; node.f9 = node; return node }
function sum(node: any) { let total = 0; for (const name of integerFields) total += node[name] ?? 0; return total }

let total = 0
for (let i = 0; i < 2000; i++) {
  const made: Node[] = [
    fillCount(make<Count>(Kind.Count, i), i), fillLate(make<CountLate>(Kind.CountLate, i), i * 2), fillPair(make<Pair>(Kind.Pair, i), -i, i), fillApart(make<PairApart>(Kind.PairApart, i), i, 1),
    fillTriple(make<Triple>(Kind.Triple, i), i), fillText(make<Text>(Kind.Text, i), "x".repeat(i % 5)), fillFlagged(make<Flagged>(Kind.Flagged, i), i % 7), fillWide(make<Wide>(Kind.Wide, i), 3), make<Plain>(Kind.Plain, i),
  ]
  for (const node of made) total += sum(node) + node.pos + node.end + node.id + node.flags + node.kind
}
console.log(total)

const triple = fillTriple(make<Triple>(Kind.Triple, 5), 40)
console.log(Object.keys(triple).join(), triple.a, triple.b, triple.c, "b" in triple, JSON.stringify(triple))
triple.b = 2 ** 31; triple.a = 0.5; (triple as any).c = "text"
console.log(Object.keys(triple).join(), triple.a, triple.b, triple.c)
const pair = make<Pair>(Kind.Pair, 1)
console.log(pair.low, pair.high, pair.low === undefined, Object.getOwnPropertyDescriptor(pair, "low"))
pair.low = -2147483648; pair.high = 2147483647
console.log(pair.low, pair.high, Object.keys(pair).join())
pair.low = -2147483647; console.log(pair.low, delete (pair as any).low, pair.low, "low" in pair, Object.keys(pair).join())
const flagged = make<Flagged>(Kind.Flagged, 2)
console.log(flagged.isOpen, flagged.depth, flagged.isLast, Object.keys(flagged).length)
flagged.isOpen = true; console.log(flagged.isOpen, flagged.depth, flagged.isLast, Object.keys(flagged).join())
