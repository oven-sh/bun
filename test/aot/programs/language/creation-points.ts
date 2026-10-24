// Which fields an object gets right after its allocation is only a hint for the compiler: the program behaves the same when the hint is wrong.
interface Sym { flags: number; name: string; parent: Sym | undefined; decls?: string[] }
interface Links { type?: Ty; target?: Sym; mapper?: string; nameType?: Ty }
interface TransientLinks extends Links { check: number }
interface TransientSym extends Sym { links: TransientLinks }
interface NodeLinks { flags: number; resolved?: Sym }
interface Ty { flags: number; id: number; sym?: Sym }
interface Ref extends Ty { target: Ty; args: Ty[] | undefined; node?: string }
function SymCtor(this: Sym, flags: number, name: string) { this.flags = flags; this.name = name; this.parent = undefined }
function NodeLinksCtor(this: NodeLinks) { this.flags = 0 }
function TyCtor(this: Ty, flags: number) { this.flags = flags }
const Sym = SymCtor as unknown as new (flags: number, name: string) => Sym
const Ty = TyCtor as unknown as new (flags: number) => Ty
const LinksClass = class implements Links {}
let types = 0
function createSym(flags: number, name: string, check?: number) {
  const sym = new Sym(flags | 1, name) as TransientSym
  sym.links = new LinksClass() as TransientLinks
  sym.links.check = check || 0
  return sym
}
function createSymWithType(source: Sym, type: Ty) {
  const sym = createSym(source.flags, source.name)
  sym.links.type = type
  sym.links.target = source
  if (source.decls) sym.decls = source.decls
  return sym
}
const nodeLinks: NodeLinks[] = []
function getNodeLinks(id: number): NodeLinks { return nodeLinks[id] || (nodeLinks[id] = new (NodeLinksCtor as any)()) }
function createTy(flags: number) { const result = new Ty(flags); types++; result.id = types; return result }
function createTyWithSym(flags: number, sym: Sym) { const result = createTy(flags); result.sym = sym; return result }
const refs = new Map<number, Ref>()
function createRef(target: Ty, args: Ty[] | undefined): Ref {
  let type = refs.get(target.id)
  if (!type) {
    type = createTyWithSym(4, createSym(0, "ref")) as Ref
    refs.set(target.id, type)
    type.target = target
    type.args = args
  }
  return type
}
class Point { y = 0; tag?: string; constructor(public x: number) { if (x < 0) this.tag = "left" } }
const plain = createSym(2, "plain")
const typed = createSymWithType(plain, createTy(8))
const ref = createRef(createTy(16), undefined)
const points: Point[] = [new Point(1)]
for (let i = 0; i < 2; i++) { points.push(new Point(-i)); for (let j = 0; j < 2; j++) points.push(new Point(j)) }
getNodeLinks(3).resolved = plain
console.log(plain.flags, plain.links.check, typed.links.type!.id, typed.links.target === plain, typed.decls, ref.id, ref.target.id, ref.sym!.name, createRef(ref.target, undefined) === ref)
console.log(getNodeLinks(3).flags, getNodeLinks(3).resolved === plain, points.length, points.map(p => p.x + ":" + p.y + ":" + p.tag).join())
