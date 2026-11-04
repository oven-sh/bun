let made = 0;
function make() { made++; return new Map([["a", 1], ["b", 2]]); }
for (const value of make().values()) console.log(value);
console.log(made);
const holder = { get map() { made++; return new Map([["g", 7]]); } };
for (const key of holder.map.keys()) console.log(key);
console.log(made);
function each(things: any) { const seen: unknown[] = []; for (const value of things.values()) seen.push(value); return seen.join(); }
console.log(each(new Map([["a", 1]])), each(new Set([2])), each([3, 4]), each({ values() { return "xy"; } }), each(new URLSearchParams("q=5")), each(new Uint8Array([6])));
for (const bad of [undefined, null, 5, {}, { values: 5 }, { values() { return 5; } }, { values() { return undefined; } }]) { try { console.log(each(bad)); } catch (error) { console.log((error as Error).constructor.name, String((error as Error).message).replace(/ \(evaluating .*\)$/, "")); } }
function typed(map: Map<string, number>) { let sum = 0; for (const value of map.values()) sum += value; return sum; }
console.log(typed(new Map([["a", 1], ["b", 2]])));
for (const wrong of [new Set([1]), [5], undefined] as any[]) { try { console.log(typed(wrong)); } catch (error) { console.log((error as Error).constructor.name); } }
