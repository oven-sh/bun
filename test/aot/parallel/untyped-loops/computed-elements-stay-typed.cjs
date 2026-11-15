// Elements that a loop computes out of another unknown list: int32s into lists of int32s, doubles and values, upward and downward.
// STATISTIC: MoveTargetsCheckedInPreheaders <= 0
const N = JSON.parse("12");
function shifted(from, to) { let carry = 0; for (let i = from.length - 1; i >= 0; i--) { to[i] = (from[i] >> 3) | carry; carry = (from[i] & 7) << 25; } return carry; }
function masked(from, to) { for (let i = 0; i < from.length; i++) to[i] = from[i] & 0xffff; return 0; }
const kinds = {
  ints: () => Array.from({ length: N }, (_, i) => i * 7919 + 13),
  doubles: () => Array.from({ length: N }, (_, i) => i * 1000.5),
  boxed: () => { const list = Array.from({ length: N }, (_, i) => i * 31); list[3] = "text"; list[3] = 3; return list; },
  values: () => Array.from({ length: N }, (_, i) => i & 1 ? "7" : { valueOf() { return i; } }),
  holes: () => [1, , 3, , 5, , 7],
  views: () => new Float64Array(N).fill(5.5),
};
const out = [];
for (const run of [shifted, masked]) for (const a in kinds) for (const b in kinds) for (let turn = 0; turn < 2; turn++) { const from = kinds[a](), to = turn ? from : kinds[b](); out.push(run.name + " " + a + " " + b + " " + run(from, to) + " " + Array.from(to, String).join()); }
console.log(out.join("\n"));
