// Prints what the compiler saves: the strings that are left behind
// A number that becomes text twice, in one joined string or in two, leaves one string for its digits behind, not two.
import { heapStats } from "bun:jsc";
const strings = () => (Bun.gc(true), heapStats().objectTypeCounts.string ?? 0);
const turns = 40000;
function report(name, most, fill) {
  const held = [];
  const before = strings();
  for (let n = 200000; n < 200000 + turns; n++) fill(held, n);
  const each = (strings() - before) / turns;
  console.log(name, held.length, held[7], each < most + 0.5 ? "at most " + most : each.toFixed(1) + " strings a turn");
}
report("joined", 3, (held, n) => held.push("t" + n + "-" + n));
report("template", 3, (held, n) => held.push(`${n}:${n}:${n}`));
report("behind a name", 4, (held, n) => held.push(held.length + "", "id" + n + "/" + n));
report("two strings", 3, (held, n) => held.push("x" + n, "y" + n));
report("two spellings", 1, (held, n) => held.push(String(n), n.toString()));
report("halves", 3, (held, n) => held.push("a" + n / 2 + "b" + n / 2));
report("a sum", 3, (held, n) => held.push("a" + (n + 0.0) + "b" + (n + 0.0)));

let calls = 0;
const counted = { toString: () => "c" + ++calls };
const texts = [];
for (let turn = 0; turn < 3; turn++) texts.push(`${counted}${counted}|` + counted + counted);
console.log(texts.join(" "), calls);
