// The interfaces below the declared `this` of a constructor function declare one literal each for `kind`, and the function stores a parameter there.
// Whatever layout an object is made with, every way to make, call, subclass, alter and list such an object answers as in plain JavaScript.
const enum Kind { Unknown, Num, Add, Neg, Name }
interface Node { kind: Kind; pos: number; end: number; parent: Node | undefined }
interface Num extends Node { kind: Kind.Num; value: number }
interface Add extends Node { kind: Kind.Add; left: Node; right: Node }
interface Neg extends Node { kind: Kind.Neg; operand: Node; note?: string }
interface Name extends Node { kind: Kind.Name; text: string }
interface NodeConstructor { new (kind: Kind, pos: number, end: number): Node; (this: Node, kind: Kind, pos: number, end: number): void; prototype: any }
function NodeObject(this: Node, kind: Kind, pos: number, end: number) { this.pos = pos; this.end = end; this.kind = kind; this.parent = undefined }
const Maker = NodeObject as NodeConstructor
Maker.prototype.describe = function (this: Node) { return this.kind + "@" + this.pos }

function base<T extends Node>(kind: T["kind"]): T { return new Maker(kind, -1, -1) as T }
function num(value: number): Num { const node = base<Num>(Kind.Num); node.value = value; return node }
function add(left: Node, right: Node): Add { const node = base<Add>(Kind.Add); node.left = left; node.right = right; left.parent = node; right.parent = node; return node }
function neg(operand: Node): Neg { const node = base<Neg>(Kind.Neg); node.operand = operand; operand.parent = node; return node }
function name(text: string): Name { const node = base<Name>(Kind.Name); node.text = text; return node }
function evaluate(node: Node): number {
  switch (node.kind) {
    case Kind.Num: return (node as Num).value
    case Kind.Add: return evaluate((node as Add).left) + evaluate((node as Add).right)
    case Kind.Neg: return -evaluate((node as Neg).operand)
    case Kind.Name: return (node as Name).text.length
    default: return 0
  }
}
function show(label: string, value: any) {
  console.log(label, Object.keys(value).join(), JSON.stringify(value, (key, held) => (key === "parent" ? undefined : held)), Object.getPrototypeOf(value) === Maker.prototype, value instanceof Maker)
}

const tree = add(neg(num(4)), add(name("abc"), num(10)))
console.log(evaluate(tree), (tree as any).describe(), (tree.left as any).describe(), tree.left.parent === tree)
show("num", num(1)); show("add", tree.right); show("neg", tree.left); show("name", name("n"))

show("outside the table", new Maker(Kind.Unknown, 1, 2))
show("larger than any", new Maker(77 as Kind, 1, 2))
for (const tag of [NaN, -0, 1.5, null, undefined, 2 ** 40, -1, 4.000000001] as any[]) {
  const made: any = new Maker(tag, 0, 0)
  console.log(typeof tag, Object.is(made.kind, tag), Object.keys(made).join(), evaluate(made))
}

const given: any = { already: 1 }
console.log(Maker.call(given, Kind.Add, 5, 6), Object.keys(given).join(), given.kind)
const again = num(3)
console.log((Maker as any).call(again, Kind.Neg, 7, 8), Object.keys(again).join(), again.kind, again.value, again.pos)
const applied: any = Reflect.apply(Maker, Object.create(null), [Kind.Name, 1, 1])
console.log(applied)

class Other { static marker = 1 }
const reflected: any = Reflect.construct(Maker, [Kind.Num, 1, 2], Other)
console.log(reflected instanceof Other, reflected instanceof Maker, Object.keys(reflected).join(), reflected.kind)
const own: any = Reflect.construct(Maker, [Kind.Num, 1, 2], Maker)
show("own new.target", own)
const bound: any = new ((Maker as any).bind(null, Kind.Add))(3, 4)
show("bound", bound)
class Sub extends (Maker as any) { extra = 1; constructor(kind: Kind) { super(kind, 9, 9) } }
const sub: any = new Sub(Kind.Neg)
console.log(sub instanceof Sub, sub instanceof Maker, Object.keys(sub).join(), sub.describe())

const changed = num(5)
;(changed as any).kind = Kind.Add
;(changed as any).left = num(1); (changed as any).right = num(2)
console.log(evaluate(changed), Object.keys(changed).join())
const late = neg(num(2))
late.note = "late"; (late as any).unknownName = 1
delete (late as any).operand
console.log(Object.keys(late).join(), "operand" in late, late.note)
const reordered = base<Add>(Kind.Add)
reordered.right = num(1); reordered.left = num(2)
console.log(Object.keys(reordered).join(), evaluate(reordered))
Object.defineProperty(reordered, "left", { get() { return num(40) }, enumerable: false, configurable: true })
console.log(Object.keys(reordered).join(), evaluate(reordered))
const frozen = Object.freeze(name("ice"))
try { (frozen as any).text = "water"; console.log("stored") } catch (error) { console.log((error as Error).constructor.name) }
console.log(frozen.text, Object.isFrozen(frozen))

const before = Maker.prototype
Maker.prototype = { describe() { return "replaced" } }
const afterwards: any = new Maker(Kind.Num, 0, 0)
console.log(afterwards.describe(), Object.getPrototypeOf(afterwards) === before, afterwards instanceof Maker, (tree as any).describe())
Maker.prototype = 5
const plain: any = new Maker(Kind.Num, 0, 0)
console.log(Object.getPrototypeOf(plain) === Object.prototype, Object.keys(plain).join())
Maker.prototype = before

let sum = 0
for (let round = 0; round < 2000; round++) sum += evaluate(add(neg(num(round)), add(name("xy"), num(round + 1))))
console.log(sum)
