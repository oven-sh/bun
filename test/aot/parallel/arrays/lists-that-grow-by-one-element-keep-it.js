// Short lists get more elements than they were made with, by index and by push, right behind a request for a collection.
// Every element is there afterwards.
const count = 20000;
const turns = 12;
let wrong = 0;
let first = "";
let base = 1000;
let sink = 0;

function note(turn, i, what, value) {
  wrong++;
  if (!first) first = "turn " + turn + " at " + i + ": " + what + " is " + (value !== null && typeof value === "object" ? "{ n: " + String(value.n) + " }" : String(value));
}

for (let turn = 0; turn < turns; turn++) {
  const byIndex = [];
  const pushed = [];
  const weight = [];
  for (let i = 0; i < count; i++) {
    byIndex.push([0, 0]);
    pushed.push([]);
  }
  for (let i = 0; i < 300000; i++) weight.push({ a: i, b: [i], c: null });

  Bun.gc(false);
  for (let i = 0; i < count; i++) {
    const n = base + i;
    const list = byIndex[i];
    list[2] = { n: n };
    list[3] = "t" + n;
    const other = pushed[i];
    other.push({ n: n });
    other.push({ n: n + 1 });
  }
  Bun.gc(true);

  for (let i = 0; i < 60000; i++) {
    const text = "g" + i + "h";
    const made = { n: -i, text: text };
    sink += text.length + made.n;
  }
  for (let i = 0; i < count; i++) {
    const n = base + i;
    const list = byIndex[i];
    const other = pushed[i];
    if (list.length !== 4 || list[2].n !== n) note(turn, i, "list[2]", list[2]);
    if (list[3] !== "t" + n) note(turn, i, "list[3]", list[3]);
    if (other.length !== 2 || other[0].n !== n) note(turn, i, "other[0]", other[0]);
    if (other[1].n !== n + 1) note(turn, i, "other[1]", other[1]);
  }
  sink += weight.length;
  base += count + 7;
}
console.log(wrong === 0 ? "every element is there" : wrong + " wrong; " + first);
