// An object literal that is cast into a family of node types does not change what is known about the required fields of that family.
enum K { A = 1, B = 2 }
interface N { kind: K; pos: number; end: number; parent: N }
interface A extends N { kind: K.A; left: N }
interface B extends N { kind: K.B; text: string }
function NCtor(this: N, kind: K, pos: number, end: number) { this.pos = pos; this.end = end; this.kind = kind; this.parent = undefined! }
const allocator = { get: () => NCtor as any as new (kind: K, pos: number, end: number) => N }
let Ctor: new (kind: K, pos: number, end: number) => N
const base = <T extends N>(kind: T["kind"]) => new (Ctor || (Ctor = allocator.get()))(kind, -1, -1) as T
const makeA = (left: N) => { const a = base<A>(K.A); a.left = left; left.parent = a; return a }
const makeB = (text: string) => { const b = base<B>(K.B); b.text = text; return b }
const show = (n: N): string => (n.kind === K.A ? "(" + show((n as A).left) + ")" : (n as B).text) + ":" + (n.end - n.pos)
const fake = { text: "fake" } as B
console.log(show(makeA(makeA(makeB("real")))), fake.text, JSON.stringify(Object.keys(fake)), "kind" in fake, JSON.stringify(Object.keys(makeB("x"))))

interface P { o: number[]; u: number; v: number; w: number }
interface Q extends P { x?: number }
function PCtor(this: P, o: number[], u: number) { this.o = o; this.u = u; this.v = 2; this.w = 3 }
const PC = PCtor as any as new (o: number[], u: number) => P
const half = { o: [1], u: 7 } as Q
const whole = new PC([1], 1) as Q
console.log(half.u, JSON.stringify(Object.keys(half)), "v" in half, whole.u + whole.v + whole.w, JSON.stringify(Object.keys(whole)))
