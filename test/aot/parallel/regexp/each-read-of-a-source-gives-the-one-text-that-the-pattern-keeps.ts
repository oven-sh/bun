// A pattern keeps the text of its `source` from the first read, and each later read in compiled code gives that one text and makes no other: for a literal, for a pattern of a written text, and for a pattern of a text that only the running program spells.
// COUNT: operation:operationAOTRegExpSource = 60000
import { heapStats } from "bun:jsc";
const literal = /^\/users\/(\d+)\/items\/(\d+)$/;
const written = new RegExp("^/users/(\\d+)$");
const spelled = new RegExp("^/posts/" + String(process.argv.length % 7) + "/(\\d+)$");
// How many texts the heap gains when every one of `count` reads is kept.
function added(read: () => string, count: number): number {
  const kept = new Array<string>(count);
  Bun.gc(true);
  const before = heapStats().objectTypeCounts.string;
  for (let at = 0; at < count; at++) kept[at] = read();
  const after = heapStats().objectTypeCounts.string;
  if (kept[count - 1] !== kept[0]) throw new Error("two reads differ");
  return after - before;
}
console.log(
  added(() => literal.source, 20000) < 100,
  added(() => written.source, 20000) < 100,
  added(() => spelled.source, 20000) < 100,
);
/* Output:
true true true
*/
