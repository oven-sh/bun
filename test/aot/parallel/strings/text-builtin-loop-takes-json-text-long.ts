// A loop builds a text, and a JSON text at its end leaves it just below the longest string, as long, or a little longer. Then the text is asked for its length, whether it is empty, or nothing at all.
type Row = { label: string; count: number };
function length(head: string, filler: string, rows: Row[], turns: number): number {
  let text = head;
  for (let i = 0; i < turns; i++) text += filler;
  text += JSON.stringify(rows);
  return text.length;
}
function isEmpty(head: string, filler: string, rows: Row[], turns: number): boolean {
  let text = head;
  for (let i = 0; i < turns; i++) text += filler;
  text += JSON.stringify(rows);
  return text === "";
}
function isTruthy(head: string, filler: string, rows: Row[], turns: number): boolean {
  let text = head;
  for (let i = 0; i < turns; i++) text += filler;
  text += JSON.stringify(rows);
  return text ? true : false;
}
function unread(head: string, filler: string, rows: Row[], turns: number): string {
  let text = head;
  for (let i = 0; i < turns; i++) text += filler;
  text += JSON.stringify(rows);
  return "made";
}
function lengthTwice(head: string, filler: string, rows: Row[], turns: number): string {
  let text = head;
  for (let i = 0; i < turns; i++) text += filler;
  text += JSON.stringify(rows);
  const first = text.length;
  text += "";
  return first + "," + text.length;
}
function lengthBehindSixMore(head: string, filler: string, rows: Row[], turns: number): number {
  let text = head;
  for (let i = 0; i < turns; i++) text += filler;
  text += JSON.stringify(rows);
  text += "abcdef";
  return text.length;
}
function lengthBetweenTwoMarks(head: string, filler: string, rows: Row[], turns: number): number {
  let text = head;
  for (let i = 0; i < turns; i++) text += filler;
  text += "<" + JSON.stringify(rows) + ">";
  return text.length;
}
function lengthBehindTwoTexts(head: string, filler: string, rows: Row[], turns: number): number {
  let text = head;
  for (let i = 0; i < turns; i++) text += filler;
  text += JSON.stringify(rows) + JSON.stringify(rows[0]);
  return text.length;
}
function attempt(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    return (error as Error).name;
  }
}

const plain: Row[] = [];
for (let i = 0; i < 300; i++) plain.push({ label: "row " + i, count: i * 1000 });
const escaped: Row[] = [];
for (let i = 0; i < 300; i++) escaped.push({ label: '"\n"\t"\\'.repeat(40) + i, count: i / 4 });
type Run = (head: string, filler: string, turns: number) => unknown;
const forms: [string, number, number, Run, Run][] = [
  ["length", 0, 0, (head, filler, turns) => length(head, filler, plain, turns), (head, filler, turns) => length(head, filler, escaped, turns)],
  ["is empty", 0, 0, (head, filler, turns) => isEmpty(head, filler, plain, turns), (head, filler, turns) => isEmpty(head, filler, escaped, turns)],
  ["is truthy", 0, 0, (head, filler, turns) => isTruthy(head, filler, plain, turns), (head, filler, turns) => isTruthy(head, filler, escaped, turns)],
  ["unread", 0, 0, (head, filler, turns) => unread(head, filler, plain, turns), (head, filler, turns) => unread(head, filler, escaped, turns)],
  ["length twice", 0, 0, (head, filler, turns) => lengthTwice(head, filler, plain, turns), (head, filler, turns) => lengthTwice(head, filler, escaped, turns)],
  ["length behind six more", 6, 6, (head, filler, turns) => lengthBehindSixMore(head, filler, plain, turns), (head, filler, turns) => lengthBehindSixMore(head, filler, escaped, turns)],
  ["length between two marks", 2, 2, (head, filler, turns) => lengthBetweenTwoMarks(head, filler, plain, turns), (head, filler, turns) => lengthBetweenTwoMarks(head, filler, escaped, turns)],
  [
    "length behind two texts",
    JSON.stringify(plain[0]).length,
    JSON.stringify(escaped[0]).length,
    (head, filler, turns) => lengthBehindTwoTexts(head, filler, plain, turns),
    (head, filler, turns) => lengthBehindTwoTexts(head, filler, escaped, turns),
  ],
];
for (const [name, , , runPlain, runEscaped] of forms) console.log(name, String(runPlain("head", "filler", 2)), String(runEscaped("head", "filler", 3)));

let piece = "x".repeat(1 << 16);
let head = "";
for (let bit = 16; bit < 31; bit++) {
  if (bit >= 22) head = head + piece;
  if (bit < 30) piece = piece + piece;
}
const left = 2 ** 31 - 1 - head.length;
for (const isEscaped of [false, true]) {
  const lengthOfRows = JSON.stringify(isEscaped ? escaped : plain).length;
  for (const [name, morePlain, moreEscaped, runPlain, runEscaped] of forms) {
    const run = isEscaped ? runEscaped : runPlain;
    let line = (isEscaped ? "escaped, " : "plain, ") + name + ":";
    for (const past of [-4097, -130, -9, -8, -7, -6, -5, -2, -1, 0, 1, 2, 5, 6, 7, 8, 9, 39, 40, 41, 127, 128, 129, 4095, 4096, 4097, 20000]) {
      const filler = "f".repeat(left - lengthOfRows - (isEscaped ? moreEscaped : morePlain) + past);
      line += " " + past + " " + attempt(() => run(head, filler, 1));
    }
    console.log(line);
  }
}
