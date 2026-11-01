// `s[i] + n` and `s[i] === t[j]` where the positions were compared with the lengths: the reads are strings there, and undefined wherever the comparisons do not say so.
function runs(text: string): string {
  let out = "";
  let at = 0;
  while (at < text.length) {
    let end = at + 1;
    while (end < text.length && text[end] === text[at]) end++;
    out += text[at]! + (end - at);
    at = end;
  }
  return out;
}

function numbered(text: string): string[] {
  const list: string[] = [];
  for (let i = 0; i < text.length; i++) list.push(text[i]! + i);
  return list;
}

function pairs(text: string): string {
  let out = "";
  for (let i = 0; i + 1 < text.length; i += 2) out += text[i + 1]! + text[i]!;
  return out;
}

function backwards(text: string): string {
  let out = "";
  for (let i = text.length - 1; i >= 0; i--) out = out + (text[i]! + ".");
  return out;
}

function onePastTheEnd(text: string): unknown[] {
  const list: unknown[] = [];
  for (let i = 0; i <= text.length; i++) list.push((text[i] as any) + i);
  return list;
}

function lengthOfAnother(text: string, other: string): unknown[] {
  const list: unknown[] = [];
  for (let i = 0; i < other.length; i++) list.push((text[i] as any) + 1);
  return list;
}

function fromBelowZero(text: string): unknown[] {
  const list: unknown[] = [];
  for (let i = -2; i < text.length; i++) list.push((text[i] as any) + 1);
  return list;
}

function textChanges(text: string): unknown[] {
  const list: unknown[] = [];
  for (let i = 0; i < text.length; i++) {
    const position = i;
    if (i === 2) text = text.slice(0, 2);
    list.push((text[position] as any) + 1);
  }
  return list;
}

function withObject(text: string): string[] {
  const list: string[] = [];
  const order: string[] = [];
  const suffix = { toString: () => (order.push("asked"), "!") };
  for (let i = 0; i < text.length; i++) list.push(text[i]! + suffix);
  return [...list, ...order];
}

function commonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

function sameAsNext(text: string): number {
  let count = 0;
  for (let i = 0; i + 1 < text.length; i++) if (text[i] == text[i + 1]) count++;
  return count;
}

function commonSubsequence(a: string, b: string): number {
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let r = 1; r <= a.length; r++)
    for (let c = 1; c <= b.length; c++)
      table[r]![c] = a[r - 1] === b[c - 1] ? table[r - 1]![c - 1]! + 1 : Math.max(table[r - 1]![c]!, table[r]![c - 1]!);
  return table[a.length]![b.length]!;
}

function differsFromTheOther(a: string, b: string): number {
  let count = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) count++;
  return count;
}

function bothPastTheEnd(a: string, b: string): boolean[] {
  const list: boolean[] = [];
  for (let i = 0; i <= a.length && i <= b.length; i++) list.push(a[i] === b[i]);
  return list;
}

const rope = "ab".repeat(3) + String(Date.now() > 0 ? "cd" : "") + "e".padEnd(4, "f");
const wide = "ααβ" + "😀" + "z";
const texts = ["", "a", "aaabbbccccd", "abcd", "zzzzzzzzzz", rope, wide, wide + rope, rope.slice(1, 7), wide.slice(1)];
for (let round = 0; round < 3; round++) {
  for (const text of texts) {
    console.log(
      JSON.stringify([
        runs(text),
        numbered(text),
        pairs(text),
        backwards(text),
        onePastTheEnd(text),
        lengthOfAnother(text, "abcde"),
        fromBelowZero(text),
        textChanges(text),
        withObject(text),
        sameAsNext(text),
      ]),
    );
    console.log(
      JSON.stringify(
        texts.map(other => [
          commonPrefix(text, other),
          commonSubsequence(text, other),
          differsFromTheOther(text, other),
          bothPastTheEnd(text, other),
        ]),
      ),
    );
  }
}
