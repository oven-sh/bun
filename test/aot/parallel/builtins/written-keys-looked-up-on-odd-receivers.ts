// Loops that look written keys up are handed receivers that are no Map and no Set, with and without a turn of the loop.
function sum(map: Map<string, number>, turns: number): number {
  let total = 0;
  for (let i = 0; i < turns; i++) total += map.get(i & 1 ? "a" : "b") ?? 1;
  return total;
}
function count(set: Set<string>, turns: number): number {
  let total = 0;
  for (let i = 0; i < turns; i++) if (set.has(i & 1 ? "a" : "b")) total++;
  return total;
}
function untyped(map: any, turns: number): number {
  let total = 0;
  for (let i = 0; i < turns; i++) total += map.get(i & 1 ? "a" : "b") ?? 1;
  return total;
}
console.log(sum(new Map([["a", 5]]), 4000), count(new Set(["a"]), 4000), untyped(new Map([["a", 5]]), 4000));
for (const odd of [null, undefined, 7, "text", {}, [], new Set(["a"]), new WeakMap(), { get: () => 2, has: () => true }, Symbol("s"), 1.5, true]) {
  for (const call of [sum, count, untyped]) {
    try {
      console.log(call.name, typeof odd, call(odd as any, 3000));
    } catch (error) {
      console.log(call.name, typeof odd, (error as Error).constructor.name);
    }
    try {
      console.log(call.name, typeof odd, "no turn", call(odd as any, 0));
    } catch (error) {
      console.log(call.name, typeof odd, "no turn", (error as Error).constructor.name);
    }
  }
}
