// what is alive at the read that fails is held by nothing but the function's own values, and much is allocated: a collection may fall into the very moment of leaving
// whoever calls goes through a name that nobody knows at build time: the function is entered by value, at its own body, and is copied into no caller
const hiddenNames = JSON.parse('["f"]');
function through<T>(f: T): T { const box: any = { f }; return ((...list: any[]) => box[hiddenNames[0]](...list)) as any; }
class Kind { flags: number; id: number; constructor(flags: number) { this.flags = flags; this.id = flags + 1; } }
function holds(type: Kind, k: number) {
  const list = [k, k + 1, k + 2], text = "k" + k + "/" + (k * 3), pair = { left: { k }, right: [text] }, made = new Kind(k);
  const a = type.flags;
  return a + ":" + list.join() + ":" + text + ":" + pair.left.k + ":" + pair.right[0] + ":" + made.id;
}
const holdsByValue = through(holds);
const other = { flags: "f", pad: 0 };
let length = 0, wrong = 0;
for (let i = 0; i < 60000; i++) {
  const answer = holdsByValue(i % 2 ? new Kind(i) : (other as any), i);
  const expected = (i % 2 ? i : "f") + ":" + i + "," + (i + 1) + "," + (i + 2) + ":k" + i + "/" + i * 3 + ":" + i + ":k" + i + "/" + i * 3 + ":" + (i + 1);
  if (answer !== expected) wrong++;
  length += answer.length;
}
console.log(length, wrong);
