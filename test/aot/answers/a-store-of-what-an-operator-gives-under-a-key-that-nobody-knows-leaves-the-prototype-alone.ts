// answers: without-library
// # `table[key] += table[last]` under a key that nobody knows: the key may spell `__proto__`, and the setter under that name passes over whatever is neither an object nor null.
// # An operator gives neither, whatever arrives at it: such a store changes no prototype, so the record stays with compiled code: its fields hold what is stored, it may gain properties, and no more.
// # A store of a value that may be an object or null under such a key lets the record go, as ever.
// # f1 = sumUp, f2 = total, f3 = bump, f4 = lay
// # L1 = rates, L2 = kept and cold (one row of keys), L3 = other
// # RUN(STAYS): link layouts mechanisms=all
// # STAYS: layout L1 changes=[GainsProperty, ChangesPrototype] stays-with-compiled-code filled-under-computed-keys
// # STAYS: layout L2 changes=[IsFrozen, GainsProperty, ChangesPrototype] stays-with-compiled-code filled-under-computed-keys
// # STAYS: layout L3 changes=[IsFrozen, GainsProperty, LosesProperty, ChangesPrototype, GetsAccessor] filled-under-computed-keys
// # RUN(FIELDS): link fields mechanisms=all
// # FIELDS: field L1.0 "a" proven=number|string|bigint writers-known filled
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 37 of 37 of 37
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function sumUp(table: Record<string, number>) { let last: string | null = null; for (const key in table) { if (last) table[key] += table[last]; last = key; } }
function total(table: Record<string, number>) { let sum = 0; for (const key in table) sum += table[key]; return sum; }
function bump(target: any, source: any) { for (const key in source) target[key] += 1; }
function lay(target: any, source: any, value: object | null) { for (const key in source) target[key] = value; }
const names = { ["__proto__"]: 1, a: 2, toString: 3, 7: 4, fresh: 5 };
const rates: Record<string, number> = { a: 0.5, b: 0.25, c: 0.125 };
const kept: Record<string, any> = { a: 1, b: 2 };
const other: Record<string, any> = { a: 1, z: 2 };
sumUp(rates);
report(rates.a);
report(rates.b);
report(rates.c);
report(total(rates));
let listed = "";
for (const key in names) listed += key + ",";
report(listed);
bump(kept, names);
report(kept.a);
report(kept.b);
report(kept[7]);
report(kept.fresh);
report(typeof kept.toString);
report(typeof kept.valueOf);
report(typeof kept.__proto__);
report(kept.seen);
listed = "";
for (const key in kept) listed += key + "=" + kept[key] + ",";
report(listed);
bump(kept, names);
report(kept.a);
report(kept.fresh);
report(typeof kept.valueOf);
report(kept.seen);
const above = { seen: "from above" };
lay(other, names, above);
report(Object.getPrototypeOf(other) === above);
report(other.seen);
report(Object.keys(other).join());
report(other.a === above);
report(typeof other.valueOf);
lay(other, { ["__proto__"]: 1 }, null);
report(Object.getPrototypeOf(other));
report(other.seen);
report(other.z);
report(typeof other.valueOf);
const bare: Record<string, any> = { __proto__: null, a: 1 };
bump(bare, names);
report(bare.a);
report(typeof bare.__proto__);
report(String(bare.__proto__));
listed = "";
for (const key in bare) listed += key + ",";
report(listed);
const cold: Record<string, any> = { a: 1, b: 2 };
Object.freeze(cold);
let thrown = "nothing";
try { bump(cold, names); } catch (e) { thrown = (e as Error).name; }
report(thrown);
report(cold.a);
const tagged: Record<PropertyKey, any> = { a: 1 };
function mark(target: any, keys: PropertyKey[]) { for (let i = 0; i < keys.length; i++) target[keys[i]] = "t" + i; }
mark(tagged, [Symbol.toStringTag, "a", "__proto__"]);
report(String(tagged));
report(tagged.a);
report(typeof tagged.valueOf);
report("end");
