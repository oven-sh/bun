// const f = c ? kind.objectFlags : 0, then masks of f: the arms of the read part at the jump
const enum Bits { None = 0, One = 1, Two = 2, Four = 4, Eight = 8, ThirtyTwo = 32 }
class Kind { flags: Bits; objectFlags: Bits; symbol: string; next: Kind | undefined; constructor(flags: Bits, objectFlags: Bits, symbol: string) { this.flags = flags; this.objectFlags = objectFlags; this.symbol = symbol; this.next = undefined; } }
function tell(f: () => unknown) { try { return String(f()); } catch (e) { return (e as Error).name; } }
// No literal lists the names of the class: its fields keep their raw slots.
function odd(text: string, name?: string, value?: unknown): any { const made = JSON.parse(text); if (name) made[name] = value; return made; }
function withGetter(text: string, name: string, get: () => unknown): any { const made = JSON.parse(text); Object.defineProperty(made, name, { get, enumerable: true, configurable: true }); return made; }
function flagsOf(kind: Kind): Bits { return kind.flags & Bits.Eight ? kind.objectFlags : 0; }
function sort(kind: Kind, c: boolean) { const f = c ? kind.objectFlags : 0; if (f & Bits.ThirtyTwo) return 1; if (f & Bits.Four) return 2; return typeof f; }
// Nobody knows who calls it: it has a body of its own, and nothing is proven of what it is handed.
const table: any[] = [sort];
for (const entered of table) {
    let seen = "";
    for (let i = 0; i < 300; i++) { const r = entered(new Kind(0, i & 36, "k"), (i & 3) !== 0); if (i < 12) seen += r + ","; }
    console.log(seen);
    const odds = [odd('{"objectFlags":"32"}'), odd('{"objectFlags":"x"}'), odd('{}', "objectFlags", undefined), odd('{}', "objectFlags", 4n), odd('{}')];
    for (let i = 0; i < 2; i++) console.log(odds.map(o => tell(() => entered(o, true)) + "|" + tell(() => entered(o, false))).join());
}
