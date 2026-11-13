// answers: without-library
// # `table.get(key)` where the table is only written to be a Map, or is proven one and may have changed: one call of one stub. The stub asks the receiver what the call by name would have to find (a cell, of the class, as its class makes it),
// # and then looks the key up itself: no name is moved at the site (it is bound into the stub, which makes it where a test fails), the receiver comes in the register of the lookup, and the comparison goes by what is PROVEN of the key:
// # a text (or nothing) by its characters, what is no text, number or bigint by its bits, all else by asking the key.
// # Odd receivers come to f1 alone: there the class is only written; what Link has seen arrive at the others may prove it.
// # f1 = text, f2 = textOrNothing, f3 = flag, f4 = whole, f5 = anything, f6 = stores, f7 = asks, f8 = drops, f9 = adds, f10 = finds, f11 = forgets, f12 = late
// # RUN(DOORS): bytes f1:Body f2:Body f3:Body f4:Body f5:Body f6:Body f7:Body f8:Body f9:Body f10:Body f11:Body f12:Body mechanisms=all
// # DOORS-LABEL: unit f1:Body
// # DOORS-NOT: BuiltinClass
// # DOORS: Stub CallMethodOfTable.MapGetString immediate (Name "get")
// # DOORS-LABEL: unit f2:Body
// # DOORS: Stub CallMethodOf{{*}}Table.MapGetString immediate (Name "get")
// # DOORS-LABEL: unit f3:Body
// # DOORS: Stub CallMethodOf{{*}}Table.MapGetBits immediate (Name "get")
// # DOORS-LABEL: unit f4:Body
// # DOORS: Stub CallMethodOf{{*}}Table.MapGetAnyValue immediate (Name "get")
// # DOORS-LABEL: unit f5:Body
// # DOORS: Stub CallMethodOf{{*}}Table.MapGetAnyValue immediate (Name "get")
// # DOORS-LABEL: unit f6:Body
// # DOORS: Stub CallMethodOf{{*}}Table.MapSetString immediate (Name "set")
// # DOORS-LABEL: unit f7:Body
// # DOORS: Stub CallMethodOf{{*}}Table.MapHasString immediate (Name "has")
// # DOORS-LABEL: unit f8:Body
// # DOORS: Stub CallMethodOf{{*}}Table.MapDeleteString immediate (Name "delete")
// # DOORS-LABEL: unit f9:Body
// # DOORS: Stub CallMethodOf{{*}}Table.SetAddString immediate (Name "add")
// # DOORS-LABEL: unit f10:Body
// # DOORS: Stub CallMethodOf{{*}}Table.SetHasBits immediate (Name "has")
// # DOORS-LABEL: unit f11:Body
// # DOORS: Stub CallMethodOf{{*}}Table.SetDeleteAnyValue immediate (Name "delete")
// # What is proven a Map enters behind the two tests of that.
// # DOORS-LABEL: unit f12:Body
// # DOORS: Stub CallMethodOfProvenTable.MapSetString immediate (Name "set")
// # DOORS: Stub CallMethodOfProvenTable.MapGetString immediate (Name "get")
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 42 of 42 of 42
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=-Inlining $SHELL
// # ALSO1: 42 of 42 of 42
// # ALSO1-NEXT: exited with 0
declare function report(value: unknown): void;
function text(table: Map<string, number>, n: number) { const key = "k" + n; const found = table.get(key); return [found]; }
function textOrNothing(table: Map<string | undefined, number>, n: number) { const key = n > 1 ? "k" + n : undefined; const found = table.get(key); return [found]; }
function flag(table: Map<boolean, number>, n: number) { const key = n > 1; const found = table.get(key); return [found]; }
function whole(table: Map<number, number>, n: number) { const key = n * 2; const found = table.get(key); return [found]; }
function anything(table: Map<unknown, number>, key: unknown) { const found = table.get(key); return [found]; }
function stores(table: Map<string, number>, n: number) { const key = "k" + n; const same = table.set(key, n); return [same]; }
function asks(table: Map<string, number>, n: number) { const key = "k" + n; const found = table.has(key); return [found]; }
function drops(table: Map<string, number>, n: number) { const key = "k" + n; const found = table.delete(key); return [found]; }
function adds(seen: Set<string>, n: number) { const key = "k" + n; const same = seen.add(key); return [same]; }
function finds(seen: Set<boolean>, n: number) { const key = n > 1; const found = seen.has(key); return [found]; }
function forgets(seen: Set<unknown>, key: unknown) { const found = seen.delete(key); return [found]; }
function late(look: (table: object) => void, n: number) { const table = new Map<string, number>(); look(table); const key = "k" + n; table.set(key, n); const found = table.get(key); return [found]; }
function tell(f: () => unknown[]) { try { const said = f()[0]; report(said instanceof Map ? "a map of " + said.size : said instanceof Set ? "a set of " + said.size : said); } catch (e) { report((e as Error).name); } }
function table<K>(first: K, second: K): Map<K, number> { const made = new Map<K, number>(); made.set(first, 1); made.set(second, 2); return made; }
function group<K>(only: K): Set<K> { const made = new Set<K>(); made.add(only); return made; }
const texts = table("k1", "k2");
tell(() => text(texts, 1)); tell(() => text(texts, 3));
tell(() => textOrNothing(table<string | undefined>(undefined, "k2"), 1)); tell(() => textOrNothing(table<string | undefined>(undefined, "k2"), 2));
tell(() => flag(table(true, false), 1)); tell(() => flag(table(true, true), 2));
tell(() => whole(table(2, 3), 1)); tell(() => whole(table(2, 3), 1.5)); tell(() => whole(table(7, 0), -0)); tell(() => whole(table(7, NaN), NaN));
tell(() => anything(table<unknown>("a", 1), "a")); tell(() => anything(table<unknown>("a", 1), 1)); tell(() => anything(table<unknown>(1n, "1"), 1n)); tell(() => anything(table<unknown>(1n, "1"), 1));
tell(() => stores(texts, 3)); tell(() => asks(texts, 3)); tell(() => drops(texts, 3)); tell(() => drops(texts, 3)); tell(() => asks(texts, 3));
const seen = group("k1");
tell(() => adds(seen, 1)); tell(() => adds(seen, 2)); tell(() => finds(group(true), 2)); tell(() => finds(group(true), 1)); tell(() => forgets(seen, "k1")); tell(() => forgets(seen, 1));
const own = table("k1", "k2"); (own as any).get = () => "own get"; (own as any).has = () => "own has"; tell(() => text(own, 1)); tell(() => asks(own, 1));
const moved = table("k1", "k2"); Object.setPrototypeOf(moved, { get() { return "moved"; } }); tell(() => text(moved, 1)); tell(() => asks(moved, 1));
tell(() => text(new WeakMap() as any, 1)); tell(() => text({ get(key: string) { return "a record's " + key; } } as any, 1)); tell(() => text(null as any, 1)); tell(() => text(5 as any, 1)); tell(() => text("text" as any, 1));
tell(() => adds(new Map() as any, 1)); tell(() => finds(table(true, false) as any, 2)); tell(() => asks(group("k1") as any, 1)); tell(() => text(Object.create(Map.prototype), 1));
tell(() => late(() => { }, 1)); tell(() => late(made => { (made as any).get = () => "hidden"; }, 1)); tell(() => late(made => { Object.setPrototypeOf(made, { set() { }, get() { return "below"; } }); }, 1));
report("end");
