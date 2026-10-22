// `var S = allocator.getSym(); new S(..) as T`: the constructor is the result of a call, so it can only be predicted.
// IR+ ^ .*IsClosureOf
// IR+ : =?L[0-9]+ = (NewObject|CreateThis) 
// IR+  = Construct v[0-9]+ \(.*\).* isFallback
declare const console: any;
interface Sym { flags: number; name: string; parent: Sym | undefined }
interface TransientSym extends Sym { links: number }
function Sym(this: Sym, flags: number, name: string) { this.flags = flags; this.name = name; this.parent = undefined; (this as any).links = 0; }
interface Allocator { getSym(): new (flags: number, name: string) => Sym }
const allocator: Allocator = { getSym: () => Sym as any };
function makeChecker() {
    var S = allocator.getSym();
    function create(flags: number, name: string): TransientSym {
        const symbol = new S(flags | 32, name) as TransientSym;
        symbol.links = flags;
        return symbol;
    }
    return create;
}
const create = makeChecker();
let s = 0; let last: TransientSym | undefined;
for (let i = 0; i < 3_000_000; i++) { const t = create(i & 7, "x"); s += t.flags + t.links; last = t; }
console.log(s, Object.keys(last!).join(), last instanceof (Sym as any));
export {};
