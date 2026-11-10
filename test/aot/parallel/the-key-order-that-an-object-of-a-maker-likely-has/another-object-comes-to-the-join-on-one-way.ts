// At the join the ways hand on different objects: nothing may be taken for the answer of the call.
// STATISTIC: KeyOrderChecksBeforeStores >= 0
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
const keysOf = (object: object) => Object.keys(object).join();
const spare = makeShape(9, 9); spare.early = 1;
function derive(from: Shape, mapper: number): Shape { let made = makeShape(from.bits, from.owner); if (from.bits & 1) made = from.bits & 2 ? spare : makeShape(7, 7); made.target = from.id; made.mapper = mapper; return made; }
const seen = new Set<string>(); for (let i = 0; i < 200; i++) seen.add(keysOf(derive(makeShape(i & 3, i), i)));
tell(() => [...seen].sort().join(" ; ")); tell(() => keysOf(spare));
console.log(said.join(" | "));
