// The checker keeps what an assignment has told it across a call: to it the element still holds the literal that was stored. The call has stored another one.
// Every use below has to see the value that is there.
const table = { a: 1, b: 2 };
const list = ["zero", "one"];

function pick(word: "a" | "b"): string {
  return word === "a" ? "first" : "second";
}

function double(count: 0 | 1): number {
  return count * 2;
}

type Held = [word: "a" | "b", count: 0 | 1, flag: boolean, maybe: number | undefined];

function change(held: Held): void {
  held[0] = "b";
  held[1] = 1;
  held[2] = true;
  held[3] = 7;
}

function run(held: Held): string {
  const lines: unknown[] = [];
  held[0] = "a";
  change(held);
  lines.push(table[held[0]], held[0] + "!", `<${held[0]}>`, held[0].charCodeAt(0), [held[0]].join(), pick(held[0]), held[0].toUpperCase(), held[0] < "b");
  const word: string = held[0];
  lines.push(word, word === "b", typeof held[0]);
  held[1] = 0;
  change(held);
  lines.push(list[held[1]], held[1] + 1, held[1] * 2, -held[1], held[1] ? "yes" : "no", String(held[1]), double(held[1]), held[1] | 4, held[1] < 1);
  const count: number = held[1];
  lines.push(count, count === 1, [10, 20][held[1]]);
  held[2] = false;
  change(held);
  lines.push(held[2] ? 1 : 2, !held[2], held[2] && "x", String(held[2]), held[2] || "y", Number(held[2]));
  if (held[2]) lines.push("taken");
  else lines.push("not taken");
  const flag: boolean = held[2];
  lines.push(flag, flag ? "set" : "clear");
  held[3] = undefined;
  change(held);
  lines.push(held[3] === undefined ? "none" : "some", typeof held[3], String(held[3]), [held[3]].length, held[3] == null);
  const maybe: number | undefined = held[3];
  lines.push(maybe, maybe === 7);
  return lines.map(String).join(" ");
}

for (let turn = 0; turn < 3; turn++) console.log(run(["a", 0, false, undefined]));
