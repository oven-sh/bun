// `list.push(a, ...other)`: the written arguments, then the members of the list, in their order; lists of integers, fractions, texts, objects, of no member and of many.
// STATISTIC: SpreadPushesCompiledAsAppends >= 2
function gather(first, source) { const out = []; out.push(first, ...source); return out; }
function gatherTwo(source, more) { const out = ["head"]; out.push(...source); out.push("mid", "dle", ...more); return out; }
const many = Array.from({ length: 300 }, (_, i) => i * 3);
for (const source of [[], [1], [1, 2, 3], [1.5, 2.5], ["a", "b"], [{ k: 1 }, null, undefined], [1, "a", 2.5, {}], many]) {
  const got = gather("f", source), two = gatherTwo(source, [source.length]);
  console.log(got.length, JSON.stringify(got.slice(0, 6)), two.length, JSON.stringify(two.slice(-4)));
}
