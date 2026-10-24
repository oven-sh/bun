// `new` on a callee that is only predicted, where the prediction is wrong at run time.
declare const console: any;
const log: any[] = [];
interface Sym { flags: number; name: string }
interface TransientSym extends Sym { links: number }
function Sym(this: Sym, flags: number, name: string) { this.flags = flags; this.name = name; }
function Other(this: Sym, flags: number, name: string) { this.flags = -flags; this.name = name + "!"; }
interface Allocator { getSym(): new (flags: number, name: string) => Sym }
const allocator: Allocator = { getSym: () => Sym as any };
function makeChecker() {
    var S = allocator.getSym();
    return (flags: number, name: string): TransientSym => { const symbol = new S(flags, name) as TransientSym; symbol.links = flags + 1; return symbol; };
}
const show = (t: TransientSym) => JSON.stringify(t) + " " + (t instanceof (Sym as any)) + " " + (t instanceof (Other as any));
const first = makeChecker();
log.push(show(first(1, "a")));
Object.assign(allocator, { getSym: () => Other });
const second = makeChecker();
log.push(show(second(2, "b")), show(first(3, "c")));
Object.assign(allocator, { getSym: () => undefined });
const third = makeChecker();
try { third(4, "d"); } catch (e: any) { log.push(e instanceof TypeError); }
Object.assign(allocator, { getSym: () => (() => 1) });
const fourth = makeChecker();
try { fourth(5, "e"); } catch (e: any) { log.push(e instanceof TypeError); }
// In a handler's sight.
function guarded(make: (flags: number, name: string) => TransientSym) { try { return show(make(6, "f")); } catch (e: any) { return "caught"; } finally { log.push("finally"); } }
log.push(guarded(first), guarded(second), guarded(third));
console.log(log.join("\n"));
export {};
