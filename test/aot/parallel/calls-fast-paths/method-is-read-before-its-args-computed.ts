// The method of a class is read before its arguments are computed: `slot.of(root().host)`, `shelf.get(codes[i])`. What the arguments do comes too late to change which function is called.
declare const process: { argv: string[] };
declare const console: { log(...values: any[]): void };
class Host { name = "host"; }
class Session { host = new Host(); turns = 0; }
class Slot { values = new Map<Host, number>(); of(host: Host): number { let value = this.values.get(host); if (value === undefined) this.values.set(host, value = this.values.size + 1); return value; } }
class Shelf { texts: string[] = []; get(index: number): string { return this.texts[index] ?? " "; } }
type Ledger = { codes: Int32Array; shelf: Shelf };
const session = new Session(), slot = new Slot(), shelf = new Shelf();
let hook: (() => void) | undefined;
function root(): Session { session.turns++; if (hook) hook(); return session; }
export function ofRoot(): number { return slot.of(root().host); }
export function entryAt(ledger: Ledger, i: number): string { return ledger.shelf.get(ledger.codes[i]!); }
for (let i = 0; i < 64; i++) shelf.texts.push(String.fromCharCode(65 + (i % 26)));
const ledger: Ledger = { codes: new Int32Array(256).map((_, i) => i % 64), shelf };
(globalThis as any).kept = [Slot, Shelf, Session, Host, ofRoot, entryAt];
const rounds = Number(process.argv[2] ?? 300000);
let sum = 0;
for (let i = 0; i < rounds; i++) sum += ofRoot() + entryAt(ledger, i & 255).length;
console.log(sum === rounds * 2);
