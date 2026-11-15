// RUN: lower
// OPTIONS: builtin-modules

// Species: proxy programs  the pairs go through other arrays first. It prints what plain Bun prints.
const log = [];
const source = { b: 2, a: 1, c: 3 };
const sorted = new Map(Object.entries(source).sort(([x], [y]) => (x < y ? -1 : 1)));
const kept = new Map(Object.entries(source).filter(([, value]) => value > 1));
const turned = new Map(Object.entries(source).map(([key, value]) => [value, key]));
const joined = new Map([...Object.entries(source), ...Object.entries({ d: "four" }), [5, 5]]);
log.push([...sorted.keys()].join(), [...kept.values()].join(), typeof turned.get(1), typeof joined.get("d"), typeof joined.get(5), typeof joined.get("a"));
console.log(log.join("; "));
