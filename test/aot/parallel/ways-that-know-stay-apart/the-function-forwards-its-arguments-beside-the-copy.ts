// the caller names arguments and forwards them behind the call that is copied
const enum Bits { None = 0, One = 1, Two = 2, Four = 4, Eight = 8, ThirtyTwo = 32 }
class Kind { flags: Bits; objectFlags: Bits; symbol: string; next: Kind | undefined; constructor(flags: Bits, objectFlags: Bits, symbol: string) { this.flags = flags; this.objectFlags = objectFlags; this.symbol = symbol; this.next = undefined; } }
function tell(f: () => unknown) { try { return String(f()); } catch (e) { return (e as Error).name; } }
// No literal lists the names of the class: its fields keep their raw slots.
function odd(text: string, name?: string, value?: unknown): any { const made = JSON.parse(text); if (name) made[name] = value; return made; }
function withGetter(text: string, name: string, get: () => unknown): any { const made = JSON.parse(text); Object.defineProperty(made, name, { get, enumerable: true, configurable: true }); return made; }
function flagsOf(kind: Kind): Bits { return kind.flags & Bits.Eight ? kind.objectFlags : 0; }
function total(...values: number[]) { let n = 0; for (const v of values) n += v; return n; }
function sort(this: unknown, kind: Kind, a: number, b: number) { const f = flagsOf(kind); const all = total.apply(null, arguments as any); return (f & Bits.Four ? 1000 : 0) + (Number.isNaN(all) ? -1 : all) + a + b; }
// Nobody knows who calls it: it has a body of its own, and nothing is proven of what it is handed.
const table: any[] = [sort];
for (const entered of table) {
    let sum = 0;
    for (let i = 0; i < 200; i++) sum += entered(new Kind(8, i & 4, "k"), i, 1);
    console.log(sum);
    for (let i = 0; i < 2; i++) console.log(entered(odd('{"flags":8,"objectFlags":"4"}', "valueOf", () => 5), 1, 2), entered(odd('{"flags":0}'), 3, 4));
}
