// An instance of a class that declares only a brand is cast to an interface with more members, as the TypeScript compiler does.
declare const console: { log(...values: unknown[]): void };
interface Ty { flags: number; id: number }
interface Links { _brand: any; type?: Ty; mapper?: string }
interface TransientLinks extends Links { check: number }
interface Sym { flags: number }
interface TransientSym extends Sym { links: TransientLinks }
function row(n: string, f: () => unknown) { try { console.log(n + ": " + String(f())) } catch (e) { console.log(n + ": THROWN: " + (e as Error).message.split("\n")[0].slice(0, 90)) } }
function SymCtor(this: Sym, flags: number) { this.flags = flags }
const Sym = SymCtor as unknown as new (flags: number) => Sym
const LinksClass = class implements Links { declare _brand: any }
function createSym(flags: number, check?: number) { const sym = new Sym(flags | 1) as TransientSym; sym.links = new LinksClass() as TransientLinks; sym.links.check = check || 0; return sym }
row("as the TypeScript compiler writes it", () => { const s = createSym(2, 3); s.links.mapper = "m"; return s.flags + " " + s.links.check + " " + s.links.mapper + " " + (s.links instanceof LinksClass) });
