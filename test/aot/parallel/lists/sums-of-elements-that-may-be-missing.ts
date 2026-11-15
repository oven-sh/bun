type Pair = number[];
const sum = (p: Pair): number => p[0]! + p[1]!;
const three = (p: Pair): number => p[0]! + p[1]! + p[2]!;
const across = (p: Pair, q: Pair): number => p[0]! + q[1]!;
const seed = process.argv.length;
const lists: Pair[] = [[seed + 0.5, seed / 3, 2.5], [seed, seed + 1, 2], [seed + 0.5], [], [NaN, 1, 2], [-0, -0, -0], [1e308, 1e308, 1e308], [2147483647, 1, 1], [seed / 7, , 3] as Pair];
const grown: Pair = []; grown[5] = 1.5; lists.push(grown);
const mixed = [1.5, "two", 3] as unknown as Pair; lists.push(mixed);
for (let turn = 0; turn < 300; turn++) for (const list of lists) if (turn === 299) console.log(sum(list), three(list), across(list, lists[(turn + 1) % lists.length]!), Object.is(sum(list), -0));
