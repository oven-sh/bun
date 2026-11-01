// A text is put together in a loop. It begins with the name of a record, which only some records have, and the loop stands behind the test of the kind.
function mix(sum: number, next: number): number {
  return (sum * 31 + next * 8) | 0;
}
type Result = { kind: 0; part: number[] } | { kind: 1; name: string } | { kind: 2 };
function make(i: number): Result {
  if (i % 7 === 3) return { kind: 1, name: "name" + i };
  if (i % 11 === 5) return { kind: 2 };
  return { kind: 0, part: [i, i + 1, i + 2] };
}
function work(i: number, n: number): string {
  const r = make(i);
  let text = "";
  if (r.kind === 1) {
    text = r.name;
    for (let j = 0; j < n; j++) text += "," + j;
  }
  return text;
}
let total = 0;
for (let i = 0; i < 400; i++) {
  const text = work(i, 12);
  total = mix(total, text.length + (text.length ? text.charCodeAt(4) : 0));
}
console.log(total, work(3, 3), work(4, 3) === "");
