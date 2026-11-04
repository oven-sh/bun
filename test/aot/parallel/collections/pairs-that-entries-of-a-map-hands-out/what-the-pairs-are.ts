const box: any = {}; (globalThis as any).box = box;
const say = (...parts: unknown[]) => console.log(parts.map(part => typeof part === "symbol" || typeof part === "bigint" ? String(part) : Object.is(part, -0) ? "-0" : typeof part === "string" ? part : JSON.stringify(part) ?? "undefined").join(" "));
const attempt = (name: string, run: () => unknown) => { try { say(name, run()); } catch (error) { say(name, "THROWS", String(error).replace(/ \(evaluating .*\)$/, "")); } };
const odd: unknown[] = ["s", 2, NaN, -0, null, undefined, 10n, Symbol.iterator, { o: 1 }, [1], true, 1.5, 2 ** 40, ""];
const map = new Map(odd.map((value, index) => [value, odd[odd.length - 1 - index]]));
const pairs = [...map.entries()]; for (const [key, value] of pairs) say(typeof key, key, value);
say(pairs.length, pairs[0] !== pairs[1], pairs.every(pair => Array.isArray(pair) && pair.length === 2 && Object.getPrototypeOf(pair) === Array.prototype), [...map.entries()][0] !== pairs[0]);
pairs[0][1] = "written"; pairs[1].push("grown"); pairs[2].length = 0; say(map.get("s"), pairs[1], pairs[2], [...map.entries()][1]);
const zero = new Map([[-0, -0]]); const [[key, value]] = [...zero.entries()]; say(1 / (key as number), 1 / (value as number), (key as number) + 1, key === 0);
const typed = new Map<number, number>([[-0, 1.5], [NaN, -0], [2 ** 31, 3]]); let sum = 0; for (const [k, v] of [...typed.entries()]) sum += 1 / k + v; say(sum, [...typed.entries()].map(([k, v]) => 1 / k + "/" + 1 / v).join());
for (const size of [0, 1, 7, 8, 9, 63, 64, 65, 1000, 20000]) { const sized = new Map(Array.from({ length: size }, (_, index) => [index % 3 ? index : "t" + index, index])); const all = [...sized.entries()]; let total = 0; for (const [, v] of all) total += v as number; say(size, all.length, total); }
let kept: unknown[][] = []; for (let turn = 0; turn < 3000; turn++) { const all = [...map.entries()]; if (turn % 500 === 0) kept.push(all[turn % all.length]); } say(kept.length, kept.map(pair => pair.length).join());
const into = [1, 2]; into.push(...(map.entries() as any)); say(into.length); const floats = [1.5, ...new Map([[1, 2]]).entries()]; say(floats); const holes = [, ...new Map([[1, 2]]).entries()]; say(holes.length, 0 in holes);
