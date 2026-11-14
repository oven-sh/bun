// What a maker gave is laid into a Map first; the names stored behind that are listed in the order of the text.
// STATISTIC: KeyOrderChecksBeforeStores >= 7
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
const registry = new Map<string, Shape>();
function refer(target: number, key: string): Shape { let found = registry.get(key); if (!found) { found = makeShape(4, target); registry.set(key, found); found.bits |= target ? 16 : 0; found.target = target; found.list = key; } return found; }
let sum = 0; for (let i = 0; i < 300; i++) sum += refer(through(i & 7), "k" + (i % 90)).id;
tell(() => sum); tell(() => keysOf(refer(1, "k5"))); tell(() => JSON.stringify(refer(1, "k6")));
console.log(said.join(" | "));
