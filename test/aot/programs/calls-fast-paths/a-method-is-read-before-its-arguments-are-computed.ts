// The method of a class is read before its arguments are computed: `slot.of(root().host)`, `pool.get(cells[i])`. What the arguments do comes too late to change which function is called.
declare const process: { argv: string[] };
declare const console: { log(...values: any[]): void };
class Host { name = "host"; }
class Session { host = new Host(); turns = 0; }
class Slot { values = new Map<Host, number>(); of(host: Host): number { let value = this.values.get(host); if (value === undefined) this.values.set(host, value = this.values.size + 1); return value; } }
class Pool { strings: string[] = []; get(index: number): string { return this.strings[index] ?? " "; } }
type Screen = { cells: Int32Array; pool: Pool };
const session = new Session(), slot = new Slot(), pool = new Pool();
let hook: (() => void) | undefined;
function root(): Session { session.turns++; if (hook) hook(); return session; }
export function ofRoot(): number { return slot.of(root().host); }
export function cellAt(screen: Screen, i: number): string { return screen.pool.get(screen.cells[i]!); }
for (let i = 0; i < 64; i++) pool.strings.push(String.fromCharCode(65 + (i % 26)));
const screen: Screen = { cells: new Int32Array(256).map((_, i) => i % 64), pool };
(globalThis as any).kept = [Slot, Pool, Session, Host, ofRoot, cellAt];
const rounds = Number(process.argv[2] ?? 300000);
let sum = 0;
for (let i = 0; i < rounds; i++) sum += ofRoot() + cellAt(screen, i & 255).length;
console.log(sum === rounds * 2);
