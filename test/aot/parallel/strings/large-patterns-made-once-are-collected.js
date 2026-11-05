// A pattern made from a large text and used once is garbage afterwards, with its text and whatever was made of it.
import { heapStats } from "bun:jsc";
function use(number) {
  const words = [];
  for (let i = 0; i < 2500; i++) words.push("w" + number + "x" + i);
  return new RegExp("^(?:" + words.join("|") + ")$").test("w" + number + "x2499");
}
const alive = () => (Bun.gc(true), heapStats().objectTypeCounts.RegExp ?? 0);
const before = alive();
let matches = 0;
for (let number = 1; number <= 200; number++) if (use(number)) matches++;
const left = alive() - before;
console.log(matches, left < 20 ? "the patterns are gone" : left + " patterns are still there");
