// COUNTER: TransitionsCachedForParsedNames = 10
// Every key is new: a transition that was only just made is not laid into the cache of names: it never comes again. One map is parsed a second time: its ten names are the ten that are laid in.
let seed = 12345;
const next = (): number => (seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff);
const text = "[" + Array.from({ length: 50 }, () => "{" + Array.from({ length: 10 }, (_, j) => '"k' + next().toString(36) + 'z":' + j).join() + "}").join() + "]";
const maps: Record<string, number>[] = JSON.parse(text);
let sum = 0, names = 0; const all = new Set<string>();
for (const map of maps) for (const key in map) { sum += map[key]!; names += key.length; all.add(key); }
console.log(maps.length, sum, names, all.size, Object.keys(maps[7]!).join() === Object.keys(JSON.parse(JSON.stringify(maps[7]))).join(), JSON.stringify(maps) === text);
