// The checker keeps what an assignment has told it across a call: to it the member still holds the literal that was stored. The call has stored another one.
// Every use below has to see the value that is there.
const table = { a: 1, b: 2 };
const list = ["zero", "one"];

function pick(word: "a" | "b"): string {
  return word === "a" ? "first" : "second";
}

function double(count: 0 | 1): number {
  return count * 2;
}

class Box {
  word: "a" | "b" = "a";
  count: 0 | 1 = 0;
  flag = false;
  maybe: number | undefined = undefined;
}

function change(box: Box): void {
  box.word = "b";
  box.count = 1;
  box.flag = true;
  box.maybe = 7;
}

function run(box: Box): string {
  const lines: unknown[] = [];
  box.word = "a";
  change(box);
  lines.push(table[box.word], box.word + "!", `<${box.word}>`, box.word.charCodeAt(0), [box.word].join(), pick(box.word), box.word.toUpperCase(), box.word < "b");
  const word: string = box.word;
  lines.push(word, word === "b", typeof box.word);
  box.count = 0;
  change(box);
  lines.push(list[box.count], box.count + 1, box.count * 2, -box.count, box.count ? "yes" : "no", String(box.count), double(box.count), box.count | 4, box.count < 1);
  const count: number = box.count;
  lines.push(count, count === 1, [10, 20][box.count]);
  box.flag = false;
  change(box);
  lines.push(box.flag ? 1 : 2, !box.flag, box.flag && "x", String(box.flag), box.flag || "y", Number(box.flag));
  if (box.flag) lines.push("taken");
  else lines.push("not taken");
  const flag: boolean = box.flag;
  lines.push(flag, flag ? "set" : "clear");
  box.maybe = undefined;
  change(box);
  lines.push(box.maybe === undefined ? "none" : "some", typeof box.maybe, String(box.maybe), [box.maybe].length, box.maybe == null);
  const maybe: number | undefined = box.maybe;
  lines.push(maybe, maybe === 7);
  return lines.map(String).join(" ");
}

for (let turn = 0; turn < 3; turn++) console.log(run(new Box()));
