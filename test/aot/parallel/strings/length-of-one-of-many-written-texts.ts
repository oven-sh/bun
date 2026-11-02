// The length of a text that is one of many written ones.
type Name =
  | "name0"
  | "name1"
  | "name2"
  | "name3"
  | "name4"
  | "name5"
  | "name6"
  | "name7"
  | "name8"
  | "name9"
  | "name10"
  | "name11";
type Word = "" | "é" | "😀" | "four" | "fives" | "sevens!" | "eight..." | "nine....." | "aa" | "bb";
type Same = "aa" | "bb" | "cc" | "dd" | "ee" | "ff" | "gg";
const names: Name[] = [
  "name0",
  "name1",
  "name2",
  "name3",
  "name4",
  "name5",
  "name6",
  "name7",
  "name8",
  "name9",
  "name10",
  "name11",
];
const words: Word[] = ["", "é", "😀", "four", "fives", "sevens!", "eight...", "nine.....", "aa", "bb"];
const same: Same[] = ["aa", "bb", "cc", "dd", "ee", "ff", "gg"];
function ofName(text: Name): number {
  return text.length;
}
function ofWord(text: Word): number {
  return text.length;
}
function ofSame(text: Same): number {
  return text.length;
}
function ofEither(text: Name | undefined): number {
  return text === undefined ? -1 : text.length;
}
function pick(i: number): Name {
  switch (i % 12) {
    case 0:
      return "name0";
    case 1:
      return "name10";
    case 2:
      return "name2";
    case 3:
      return "name11";
    case 4:
      return "name4";
    case 5:
      return "name5";
    case 6:
      return "name6";
    case 7:
      return "name7";
    case 8:
      return "name8";
    case 9:
      return "name9";
    case 10:
      return "name1";
    default:
      return "name3";
  }
}
const lines: string[] = [];
for (const name of names) lines.push(name + " " + ofName(name));
for (const word of words) lines.push(JSON.stringify(word) + " " + ofWord(word));
for (const text of same) lines.push(text + " " + ofSame(text));
let sum = 0;
for (let i = 0; i < 48; i++) sum = sum * 3 + ofName(pick(i)) + ofEither(i & 3 ? pick(i + 1) : undefined);
lines.push(String(sum % 1000003));
// Texts of the same characters that were made at run time.
for (const name of names) lines.push(String(ofName(("na" + name.slice(2)) as Name)));
console.log(lines.join("\n"));
