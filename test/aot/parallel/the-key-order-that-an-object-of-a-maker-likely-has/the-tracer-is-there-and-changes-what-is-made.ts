// What the makers hand to unknown code comes back with another order.
// STATISTIC: KeyOrdersAskedInFrontOfStores >= 28
const said: string[] = [];
function tell(what: () => unknown) { try { said.push(String(what())); } catch (error: any) { said.push(error.constructor.name + ": " + error.message); } }
const through = new Function("x", "return x");
interface Shape { flags: number; keeper?: object; id: number; owner: number; bits: number; parts: undefined | number[]; rows: undefined | number[]; target?: Shape | number; list?: unknown; mapper?: unknown; alias?: unknown; declaration?: number; parameter?: unknown; node?: number; first?: number; last?: number; marked?: number; early?: number }
const debugging: boolean = through(false); const keeper = {}; let tracer: undefined | { record(shape: Shape): void } = through(undefined);
let count = 0;
function Shape(this: Shape, holder: object, flags: number) { this.flags = flags; if (debugging) this.keeper = holder; }
function createShape(flags: number): Shape { const result: Shape = new (Shape as any)(keeper, flags); count++; result.id = count; tracer?.record(result); return result; }
function createOwned(flags: number, owner: number): Shape { const result = createShape(flags); result.owner = owner; return result; }
function makeShape(bits: number, owner: number): Shape { const made = createOwned(8, owner); made.bits = bits; made.parts = undefined; made.rows = undefined; return made; }
interface Wider extends Shape { declaration: number; parameter: unknown; node: number; first: number; last: number }
const keysOf = (object: object) => Object.keys(object).join();
function derive(from: Shape, mapper: number): Shape { const made = makeShape(from.bits, from.owner); if (from.bits & 1) (made as Wider).first = 1; made.target = from; made.mapper = mapper; return made; }
const seen = new Set<string>(); for (let i = 0; i < 100; i++) seen.add(keysOf(derive(makeShape(i & 1, i), i)));
tracer = through({ record(shape: any) { if (shape.id & 1) shape.marked = 1; else shape.mapper = 0; } });
for (let i = 0; i < 100; i++) seen.add(keysOf(derive(makeShape(i & 1, i), i)));
tell(() => [...seen].sort().join(" ; "));
console.log(said.join(" | "));
