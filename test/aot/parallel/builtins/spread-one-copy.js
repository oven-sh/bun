// Flags: --aot-limit=MaxVersionedIterationBytes:1
// A spread of a list, a Set, a text, a Map's iterator, a generator or an iterable of the program's own, where all the arms of the walk share one copy of the code.
// What an arm's opening finds out reaches the shared copy through the join: whether `next` is the engine's own is one such thing.
function count(l) { return [...l].length; }
function join(l) { return [...l].join(); }
function call(l) { return Math.max(...l); }
function* numbers() { yield 4; yield 5; }
const own = { [Symbol.iterator]() { let i = 0; return { next: () => (i < 3 ? { done: false, value: i++ } : { done: true, value: undefined }) }; } };
const sources = [[1, 2], new Set([3]), "12", new Map([[1, 2]]).keys(), numbers(), own, new Set([7, 8]).values(), [9][Symbol.iterator]()];
const lines = [];
for (const make of [() => [1, 2], () => new Set([3]), () => "12", () => new Map([[1, 2]]).keys(), () => numbers(), () => own, () => new Set([7, 8]).values(), () => [9][Symbol.iterator]()])
  lines.push([count(make()), join(make()), call(make())].join(" "));
for (const bad of [null, undefined, 5, {}, { [Symbol.iterator]: 1 }, { [Symbol.iterator]() { return {}; } }, { [Symbol.iterator]() { return { next() { return 1; } }; } }]) {
  try { lines.push(count(bad)); } catch (e) { lines.push(e.constructor.name); }
}
console.log(lines.join("\n"), sources.length);
