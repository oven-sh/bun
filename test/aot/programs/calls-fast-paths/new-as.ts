// `new C() as T` and `new F(..) as T`: the constructor is known, so the object is allocated in place with the layout of its constructor, and the cast adds no call.
// IR- ^ .*= Construct v
// IR+ ^layout (L[0-9]+) .*name="Sym" [\s\S]*: =?\1 = (NewObject|CreateThis) 
// IR+ ^layout (L[0-9]+) .*name="Links" [\s\S]*: =?\1 = (NewObject|CreateThis) 
declare const console: any;
interface Links { _brand: any }
interface TransientLinks extends Links { check: number; target: Sym | undefined }
interface Sym { flags: number; name: string; parent: Sym | undefined }
interface TransientSym extends Sym { links: TransientLinks }
const Links = class implements Links { declare _brand: any; };
function Sym(this: Sym, flags: number, name: string) { this.flags = flags; this.name = name; this.parent = undefined; (this as any).links = undefined; }
function create(flags: number, name: string, check: number): TransientSym {
    const symbol = new (Sym as any as new (flags: number, name: string) => Sym)(flags | 32, name) as TransientSym;
    symbol.links = new Links() as TransientLinks;
    symbol.links.check = check;
    return symbol;
}
let s = 0; let last: TransientSym | undefined;
for (let i = 0; i < 3_000_000; i++) { const t = create(i & 7, "x", i & 1); s += t.flags + t.links.check; last = t; }
console.log(s, Object.keys(last!).join(), Object.keys(last!.links).join(), last!.links instanceof Links, last instanceof (Sym as any), last!.links.target);
export {};
