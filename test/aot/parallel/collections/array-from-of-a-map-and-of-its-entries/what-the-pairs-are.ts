const box: any = {}; (globalThis as any).box = box;
const say = (...parts: unknown[]) => console.log(parts.map(part => typeof part === "symbol" || typeof part === "bigint" ? String(part) : Object.is(part, -0) ? "-0" : typeof part === "string" ? part : JSON.stringify(part) ?? "undefined").join(" "));
const attempt = (name: string, run: () => unknown) => { try { say(name, run()); } catch (error) { say(name, "THROWS", String(error)); } };
const log: string[] = []; const told = () => { const all = log.join(); log.length = 0; return all; };
function copy(items: any) { return Array.from(items); }
function copyOf(name: string) { return Array.from(box[name]); }
const odd: unknown[] = ["s", 2, NaN, -0, null, undefined, 10n, Symbol.iterator, { o: 1 }, [1], true, 1.5, 2 ** 40, ""];
const map = new Map(odd.map((value, index) => [value, odd[odd.length - 1 - index]]));
for (let turn = 0; turn < 3; turn++) {
  const pairs = copy(map) as unknown[][]; for (const [key, value] of pairs) say(typeof key, key, value);
  say(pairs.length, pairs[0] !== pairs[1], pairs.every(pair => Array.isArray(pair) && pair.length === 2 && Object.getPrototypeOf(pair) === Array.prototype), (copy(map) as unknown[][])[0] !== pairs[0], Array.isArray(pairs), Object.getPrototypeOf(pairs) === Array.prototype);
  pairs[0][1] = "written"; pairs[1].push("grown"); pairs[2].length = 0; pairs.push(["more"]); say(map.get("s"), pairs[1], pairs[2], pairs.length, (copy(map.entries()) as unknown[][])[1]);
  const zero = new Map([[-0, -0]]); for (const items of [zero, zero.entries()]) { const [[key, value]] = copy(items) as number[][]; say(1 / key, 1 / value, key + 1, key === 0, Object.is(key, 0)); }
  const typed = new Map<number, number>([[-0, 1.5], [NaN, -0], [2 ** 31, 3]]); typed.set(NaN, 7); typed.set(0, 2.5); let sum = 0; for (const [k, v] of Array.from(typed)) sum += 1 / k + v; say(sum, typed.size, Array.from(typed.entries()).map(([k, v]) => 1 / k + "/" + 1 / v).join());
  for (const size of [0, 1, 7, 8, 9, 63, 64, 65, 1000, 20000]) { const sized = new Map(Array.from({ length: size }, (_, index) => [index % 3 ? index : "t" + index, index])); const all = copy(sized) as unknown[][], other = copy(sized.entries()) as unknown[][]; let total = 0; for (const [, v] of all) total += v as number; for (const [, v] of other) total -= v as number; say(size, all.length, other.length, total); }
}
let kept: unknown[][] = []; for (let turn = 0; turn < 3000; turn++) { const all = copy(map) as unknown[][]; if (turn % 500 === 0) kept.push(all[turn % all.length]); } say(kept.length, kept.map(pair => pair.length).join());
