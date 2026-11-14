// pairs over Maps asked at run time, in the places where a value between the step and the pattern could go stale: generators, async functions, try and finally, loops in loops, labels, closures, defaults, patterns in patterns, assignments
const log: string[] = [];
type M = Map<string, number>;
function* drawn(map: M): Generator<string> { for (const [key, value] of map) { yield key; yield String(value); } }
async function awaited(map: M): Promise<string> { let out = ""; for (const [key, value] of map) { out += key; await null; out += value; } return out; }
function tried(map: M): string { let out = ""; try { for (const [key, value] of map) { try { if (value === 2) throw key; out += key; } catch (caught) { out += "(" + caught + ")"; } finally { out += "."; } } } finally { out += "!"; } return out; }
function nested(map: M, other: M): string { let out = ""; for (const [key, value] of map) for (const [inner, more] of other) out += key + inner + (value + more); return out; }
function same(map: M): string { let out = ""; for (const [key] of map) for (const [, value] of map) out += key + value; return out; }
function labeled(map: M, other: M): string { let out = ""; outer: for (const [key, value] of map) { for (const [inner, more] of other) { if (more === 2) continue outer; if (value === 3) break outer; out += key + inner; } } return out; }
function closures(map: M): string { const made: (() => string)[] = []; for (const [key, value] of map) made.push(() => key + value); return made.map(run => run()).join(); }
function defaults(map: Map<string, number | undefined>): string { let out = ""; for (const [key = "none", value = (log.push("default"), -1)] of map) out += key + value; return out; }
function deep(map: Map<string, [number, { x: string }]>): string { let out = ""; for (const [key, [first, { x }]] of map) out += key + first + x; return out; }
function assigned(map: M): string { let key = "", value = 0, out = ""; for ([key, value] of map) out += key + value; return out + key + value; }
function fields(map: M): string { const into: any = {}; let out = ""; for ([into.key, into.value] of map) out += into.key + into.value; return out; }
function small(map: M): number { let sum = 0; for (const [, value] of map) sum += value; return sum; }
function copied(maps: M[]): number { let sum = 0; for (const map of maps) sum += small(map); return sum; }
function cleared(map: M): string { let out = ""; for (const [key, value] of map) { out += key + value; if (value === 1) { map.clear(); map.set("z", 9); } } return out; }
function long(map: Map<number, number>): number { let sum = 0; for (const [key, value] of map) sum += key * value; return sum; }
(globalThis as any).handedOut = { drawn, awaited, tried, nested, same, labeled, closures, defaults, deep, assigned, fields, small, copied, cleared, long };
const make = () => new Map<string, number>([["a", 1], ["b", 2], ["c", 3]]);
class Sub extends Map<string, number> { *[Symbol.iterator](): any { log.push("own"); yield ["s", 7]; yield ["t", 2]; yield "uv"; } }
const big = new Map<number, number>(); for (let i = 0; i < 300; i++) big.set(i, i % 7); for (let i = 0; i < 300; i += 3) big.delete(i);
for (let round = 0; round < 3; round++) {
  for (const build of [make, () => new Sub()]) {
    console.log([...drawn(build())].join(), await awaited(build()), tried(build()), nested(build(), make()), nested(make(), build()), same(build()), labeled(build(), make()), labeled(make(), build()), closures(build()), assigned(build()), fields(build()), small(build()), copied([build(), make(), build()]), cleared(build()), log.splice(0).join());
  }
  console.log(defaults(new Map<string, number | undefined>([["a", undefined], [undefined as any, 2]])), deep(new Map([["k", [1, { x: "y" }]]])), long(big), log.splice(0).join());
}
