// `const table = { .. }` at the top of a module is made by whoever reads it first. Every read finds that one object, round calls that nobody knows, in loops, round awaits, and in front of the declaration none.
const log: string[] = [];
function early(): string { try { return String(late.a); } catch (error) { return (error as Error).name; } }
log.push(early());
const table = { a: 1, b: 2 };
const pattern = /x+/g;
const late = { a: 5 };
log.push(early());
function roundCalls(run: () => void): string { const first = table; first.a++; run(); const second = table; second.b++; run(); return (first === second) + ":" + table.a + ":" + table.b; }
log.push(roundCalls(() => { table.a += 10; }), roundCalls(() => { globalThis.queueMicrotask(() => {}); }));
function inLoop(): number { let sum = 0; for (let i = 0; i < 3; i++) { sum += table.a; log.length; table.a++; } return sum; }
log.push(String(inLoop()));
function matches(text: string): string { const a = pattern.exec(text); log.length; const b = pattern.exec(text); return (a && a[0]) + ":" + (b && b[0]) + ":" + pattern.lastIndex; }
log.push(matches("xx x xxx"), matches("xx x xxx"));
async function roundAwaits(): Promise<string> { const before = table; await null; const after = table; after.b = 100; await null; return (before === after) + ":" + table.b + ":" + late.a; }
log.push(await roundAwaits());
console.log(log.join("\n"));
