type Holder = { row?: Row };
type Row = { id: number; extra?: Extra; other?: string };
type Extra = { label: string };
function plain(id: number): Row { return { id }; }
function deferred(id: number, label: string): Row { return { id, get extra() { return { label }; } }; }
function holding(row?: Row): Holder { return row ? { row } : {}; }
const pile: Holder[] = []; for (let i = 0; i < 40; i++) pile.push(holding(i & 1 ? plain(i) : deferred(i, "p" + i)));
(globalThis as any).pile = pile;
const printed: string[] = [];
function visit(holders: Holder[]) { const picked = holders[0]?.row; const found = picked?.extra; printed.push(String(new Map([[found, 1]]).size)); }
(globalThis as any).extra = visit;
visit([holding(deferred(1, "b"))]); visit([holding(plain(2))]); for (const item of pile.slice(0, 4)) visit([item]);
console.log(printed.join(" "));
