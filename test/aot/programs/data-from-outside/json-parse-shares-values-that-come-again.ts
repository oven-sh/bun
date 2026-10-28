// A string value of some tens of characters that comes again with every text is one string, whichever parser takes the text: 2,000 parsed objects that are kept hold one copy of it, not 2,000.
declare function generateHeapSnapshot(): { nodeClassNames: string[]; nodes: number[] };
declare function gc(): void;
function countStrings(): number {
  gc();
  const snapshot = generateHeapSnapshot();
  let count = 0;
  for (let at = 0; at < snapshot.nodes.length; at += 4) if (snapshot.nodeClassNames[snapshot.nodes[at + 2]!] === "string") count++;
  return count;
}
const kept: unknown[] = [];
function measure(label: string, value: string, parse: (text: string) => unknown, isCounted = true) {
  const text = (at: number) => '{"' + label.replaceAll(" ", "") + '":' + at + ',"again":"' + value + '","short":"abc"}';
  for (let at = 0; at < 50; at++) kept.push(parse(text(at)));
  countStrings();
  const before = countStrings();
  for (let at = 0; at < 2000; at++) kept.push(parse(text(at)));
  const more = countStrings() - before;
  if (isCounted) console.log(label + ": " + (more < 100 ? "shared" : more + " more strings for 2,000 objects"));
}
interface Row { again: string; short: string }
const made: Row = { again: "", short: "" };
// The texts of the numbers 0 to 1,999, which stand in every text that is parsed, are remembered where they are first made, in any Bun. One round goes ahead of the count for them.
measure("no type", "u".repeat(10), text => JSON.parse(text), false);
measure("a reviver", "u".repeat(10), text => JSON.parse(text, (_, held) => held), false);
for (const length of [10, 17, 29, 30, 31, 36, 64, 200, 256]) {
  measure("no type " + length, "v".repeat(length), text => JSON.parse(text));
  measure("a reviver " + length, "w".repeat(length), text => JSON.parse(text, (_, held) => held));
}
console.log(made.short.length);
