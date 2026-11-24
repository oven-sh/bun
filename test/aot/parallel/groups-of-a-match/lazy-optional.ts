// Every group of a match is read, measured and compared. What is printed is what plain Bun prints.
const unseen = (x: any): any => [x][JSON.parse("0")];
const alphabet: string[] = unseen(["a", "b", "c", "=", "A", "1", "\n", "\u4e2d"]);
function textsUpTo(length: number): string[] {
  let last = [""];
  const all = [""];
  for (let i = 0; i < length; i++) {
    const next: string[] = [];
    for (const text of last) for (const unit of alphabet) next.push(text + unit);
    all.push(...next);
    last = next;
  }
  return all;
}
function told(text: string): string {
  const m = /(a)??b/.exec(text);
  if (!m) return "-";
  return String(m[0]) + "," + String(m[1]);
}
function measured(text: string): number {
  const m = /(a)??b/.exec(text);
  if (m === null) return -2;
  return (m[0] === undefined ? -1 : m[0]!.length) + (m[1] === undefined ? -1 : m[1]!.length);
}
function compared(text: string): number {
  const m = text.match(/(a)??b/);
  return m ? (m[0] === "a" ? 1 : 0) + (m[1] === "a" ? 2 : 0) + m.index! * 1000 + m.length * 100000 : -3;
}
let lengths = 0, sames = 0, hash = 0;
const seen = new Set<string>();
for (const text of textsUpTo(4)) {
  const groups = told(text);
  seen.add(groups);
  for (let i = 0; i < groups.length; i++) hash = (hash * 31 + groups.charCodeAt(i)) | 0;
  lengths += measured(text);
  sames = (sames * 7 + compared(text)) | 0;
}
console.log([...seen].sort().slice(0, 40).map(groups => JSON.stringify(groups)).join("\n"));
console.log(seen.size, hash, lengths, sames);
