// Frozen, sealed, with an accessor under the very name, with another prototype.
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
let got = 0;
const spoil = through(function (shape: any, i: number) { switch (i % 6) { case 1: Object.freeze(shape); break; case 2: Object.seal(shape); break; case 3: Object.defineProperty(shape, "target", { set(v) { got += v; }, get() { return -1; }, enumerable: true, configurable: true }); break; case 4: Object.setPrototypeOf(shape, { set list(v: number) { got += 1000; } }); break; case 5: Object.preventExtensions(shape); break; } return 1; });
function refer(target: number, i: number): Shape { const found = makeShape(4, target); spoil(found, i); found.target = target; found.list = i; return found; }
const seen = new Set<string>(); for (let i = 0; i < 120; i++) { try { seen.add(keysOf(refer(i & 7, i))); } catch (error: any) { seen.add(error.constructor.name); } }
tell(() => [...seen].sort().join(" ; ")); tell(() => got);
console.log(said.join(" | "));
