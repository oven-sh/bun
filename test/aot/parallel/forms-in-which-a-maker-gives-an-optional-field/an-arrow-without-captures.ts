type Holder = { row?: Row };
type Row = { id: number; extra?: () => number; other?: string };
type Extra = { label: string };
function plain(id: number): Row { return { id }; }
function build(id: number): Row { return { id, extra: () => 5 }; }
function holding(row?: Row): Holder { return row ? { row } : {}; }
const pile: Holder[] = []; for (let i = 0; i < 40; i++) pile.push(holding(i & 1 ? plain(i) : build(i)));
(globalThis as any).pile = pile;
const printed: string[] = [];
function call(value: any): string { try { return String(value()); } catch (error) { return "throws " + (error as Error).constructor.name; } }
function show(value: unknown): string { return typeof value === "function" ? "function:" + call(value) : typeof value === "object" && value ? JSON.stringify(value) : String(value); }
function visit(holders: Holder[]) { const picked = holders[0]?.row; const found = picked?.extra; printed.push(show(found)); printed.push(picked ? Object.keys(picked).join() : "-"); }
(globalThis as any).extra = visit;
visit([holding(build(1))]); visit([holding(plain(2))]); for (const item of pile.slice(0, 4)) visit([item]);
console.log(printed.join(" "));
