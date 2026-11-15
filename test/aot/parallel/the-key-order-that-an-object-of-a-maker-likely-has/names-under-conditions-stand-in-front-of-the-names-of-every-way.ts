// The usual way skips both conditions; the other ways take one or both: every order is the order of the stores as they ran.
// STATISTIC: KeyOrderChecksBeforeStores >= 17
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
function derive(from: Shape, mapper: number, alias: number): Shape {
  const made = makeShape(from.bits, from.owner);
  if (from.bits & 1) { (made as Wider).declaration = from.id; (made as Wider).parameter = mapper; }
  if (from.bits & 2) (made as Wider).node = from.id;
  made.target = from; made.mapper = mapper; made.alias = alias || from.alias; made.list = alias ? mapper : from.list;
  return made;
}
const seen = new Map<string, number>(); let last = makeShape(0, 1);
for (let i = 0; i < 400; i++) { const from = makeShape(i % 50 === 0 ? 1 : i % 70 === 0 ? 2 : i % 90 === 0 ? 3 : 0, i); last = derive(from, i, i & 1); seen.set(keysOf(last), (seen.get(keysOf(last)) || 0) + 1); }
tell(() => [...seen].map(([keys, times]) => times + ":" + keys).sort().join(" ; ")); tell(() => keysOf(derive(makeShape(3, 2), 5, 0)));
console.log(said.join(" | "));
