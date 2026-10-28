// Inside `try`, facts that the compiler has established are kept across calls that may throw.
// IR= 0 create  = Claim v[0-9]+(?!.* isProven)
// IR= 0 create PropGet v[0-9]+ name="links"(?!.* isFallback)
// IR= 1 twice PropGet v[0-9]+ name="x"(?!.* isFallback)
// IR= 2 twiceAroundACall PropGet v[0-9]+ name="x"(?!.* isFallback)
declare const console: any;
interface Links { _brand: any }
interface TransientLinks extends Links { check: number; target: Sym | undefined }
interface Sym { flags: number; name: string; parent: Sym | undefined }
interface TransientSym extends Sym { links: TransientLinks }
const Links = class implements Links { declare _brand: any; };
function Sym(this: Sym, flags: number, name: string) { this.flags = flags; this.name = name; this.parent = undefined; (this as any).links = undefined; }
let failures = 0;
function create(flags: number, name: string, check: number): TransientSym | undefined {
    try {
        const symbol = new (Sym as any as new (flags: number, name: string) => Sym)(flags | 32, name) as TransientSym;
        symbol.links = new Links() as TransientLinks;
        symbol.links.check = check;
        return symbol;
    } catch (e) { failures++; return undefined; }
}
class P { constructor(public x: number, public y: number) {} }
let calls = 0;
function other(p: P): void { calls++; if ((calls & 1023) === 0) p.x++; }
function twice(p: P): number { try { return p.x * 3 + p.y + p.x; } catch (e) { failures++; return 0; } }
function twiceAroundACall(p: P): number { try { const a = p.x; other(p); return a + p.x; } catch (e) { failures++; return 0; } }
let s = 0; let last: TransientSym | undefined; const p = new P(1, 2);
function run(): void { for (let i = 0; i < 3_000_000; i++) { const t = create(i & 7, "x", i & 1)!; s += t.flags + t.links.check + twice(p) + twiceAroundACall(p); last = t; } }
run();
console.log(s, failures, calls, Object.keys(last!).join(), Object.keys(last!.links).join(), last!.links instanceof Links, p.x);
export {};
