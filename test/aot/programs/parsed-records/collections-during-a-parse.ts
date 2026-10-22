const leak = new Function("value", process.argv.length > 99 ? "" : "return value");
function parse(text: string, reviver?: any): any {
  return JSON.parse(text, reviver);
}
interface Entry { id: number; name: string; tags: string[]; child: { value: number; text: string } }
function check(entry: Entry, n: number): boolean {
  return entry.id === n && entry.name === `name-${n}` && entry.tags.length === 3 && entry.tags[2] === `t${n}-2` && entry.child.value === n * 2 && entry.child.text === `text ${n} ${"x".repeat(n % 50)}`;
}
leak({ id: 0, name: "", tags: [], child: { value: 0, text: "" } } satisfies Entry);
console.log(check({ id: 1, name: "name-1", tags: ["", "", "t1-2"], child: { value: 2, text: "text 1 x" } }, 1));
function text(count: number): string {
  const parts: string[] = [];
  for (let n = 0; n < count; n++) parts.push(`{"id":${n},"name":"name-${n}","tags":["t${n}-0","t${n}-1","t${n}-2"],"child":{"value":${n * 2},"text":"text ${n} ${"x".repeat(n % 50)}"}}`);
  return `[${parts.join()}]`;
}
const large = text(60000);
let kept: Entry[][] = [];
for (let round = 0; round < 6; round++) {
  const entries: Entry[] = parse(large);
  let right = 0;
  for (let n = 0; n < entries.length; n++) if (check(entries[n]!, n)) right++;
  console.log(entries.length, right);
  kept.push(entries);
  if (kept.length > 2) kept.shift();
  Bun.gc(true);
  let stillRight = 0;
  for (const list of kept) for (let n = 0; n < list.length; n += 997) if (check(list[n]!, n)) stillRight++;
  console.log(stillRight);
}
for (let round = 0; round < 20000; round++) {
  const entry: Entry = parse(`{"id":${round},"name":"name-${round}","tags":["a","b","t${round}-2"],"child":{"value":${round * 2},"text":"text ${round} ${"x".repeat(round % 50)}"}}`);
  if (!check(entry, round)) console.log("wrong", round);
  if (round % 5000 === 0) Bun.gc(true);
}
console.log("done");
export {};
