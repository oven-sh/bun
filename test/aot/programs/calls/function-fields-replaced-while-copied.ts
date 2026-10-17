// Copies of a record whose field the typed program assigns one function expression to, with another function put in its place while it is copied.
const lines: string[] = [];
type Fn = (x: number) => number;
const others: Fn[] = [x => x * 100, x => x * 1000];
function pick(i: number): Fn { return others[i & 1]; }
interface R1 { k: number; f1: Fn }
function make1(k: number): R1 { return { k, f1: x => x + 1 }; }
function spreadThenStore(rounds: number): number { let s = 0; for (let i = 0; i < rounds; i++) { const a = make1(i); s += a.f1(1); const b: R1 = { ...a, f1: pick(i) }; s += b.f1(1); const c: R1 = { ...a }; c.f1 = pick(i + 1); s += c.f1(1) + a.f1(1); } return s; }
lines.push("a spread with the member replaced: " + spreadThenStore(4));
interface R2 { k: number; f2: Fn }
function make2(k: number): R2 { return { k, f2: x => x + 2 }; }
const kept2: R2[] = [];
function spreadKept(rounds: number): number { let s = 0; for (let i = 0; i < rounds; i++) { const a = make2(i); kept2.push({ ...a, f2: pick(i) }); kept2.push(a); } for (const r of kept2) s += r.f2(1); return s; }
lines.push("the copies are kept: " + spreadKept(4));
interface R3 { k: number; f3: Fn }
function make3(k: number): R3 { return { k, f3: x => x + 3 }; }
function withMore<T extends R3>(value: T, f: Fn): T { return { ...value, f3: f }; }
function generic(rounds: number): number { let s = 0; for (let i = 0; i < rounds; i++) { const a = make3(i); const b = withMore(a, pick(i)); s += a.f3(1) + b.f3(1); } return s; }
lines.push("under a type parameter: " + generic(4));
interface R4 { k: number; f4: Fn }
function make4(k: number, f?: Fn): R4 { const made: R4 = { k, f4: x => x + 4 }; if (f) made.f4 = f; return made; }
function conditional(rounds: number): number { let s = 0; for (let i = 0; i < rounds; i++) s += make4(i, i & 1 ? pick(i) : undefined).f4(1); return s; }
lines.push("stored on one path: " + conditional(4));
console.log(lines.join("\n"));
