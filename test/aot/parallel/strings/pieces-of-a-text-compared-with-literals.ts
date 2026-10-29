// A piece of a text that is cut from a position to a fixed number of units behind it is compared with literals of that length, of other lengths, in narrow and in wide texts, and at the end of the text.
function commasIn(text: string): number {
  let count = 0;
  for (const character of text) if (character === ",") count++;
  return count;
}

function wideIn(text: string): number {
  let count = 0;
  for (const character of text) if (character === "é" || character === "中" || character === "😀") count++;
  return count;
}

function pairsIn(text: string): number {
  let count = 0;
  for (let at = 0; at < text.length; at++) if (text.slice(at, at + 2) === ", ") count++;
  return count;
}

function onesBySlice(text: string): number {
  let count = 0;
  for (let at = 0; at < text.length; at++) {
    if (text.slice(at, at + 1) === ",") count++;
    if (text.substring(at, at + 1) === ", ") count += 100;
    if (text.slice(at, at + 3) === ",") count += 1000;
  }
  return count;
}

function pastTheEnd(text: string): string {
  const seen: boolean[] = [];
  for (let at = text.length - 2; at < text.length + 2; at++) seen.push(text.slice(at, at + 1) === ",", text.slice(at, at + 2) === ",,", text.charAt(at) === ",");
  return seen.join(" ");
}

const texts = ["", ",", ",,", "a,b, c,, d", "no comma", ", ".repeat(9), "café, 中文, 😀,", "\ud83d,\ude00", "x".repeat(70) + ",", ",".repeat(33)];
for (let round = 0; round < 3; round++) {
  for (const text of texts) console.log(commasIn(text), wideIn(text), pairsIn(text), onesBySlice(text), pastTheEnd(text));
}
console.log(commasIn(texts.join(",") + String(texts.length)), commasIn(JSON.stringify(texts)));
