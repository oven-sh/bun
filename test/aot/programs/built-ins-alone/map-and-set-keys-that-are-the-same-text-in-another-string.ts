const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-_.,:;!?";
const lengths = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 15, 16, 17, 23, 24, 25, 31, 32, 33, 40, 63, 64, 65];

function textOf(length: number, seed: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[(seed * 7 + i * 13) % alphabet.length];
  return out;
}
function anotherStringOf(text: string, way: number): string {
  switch (way) {
    case 0:
      return ("<" + text + ">").slice(1, -1);
    case 1:
      return text.split("").join("");
    case 2:
      return String.fromCharCode(...Array.from(text, character => character.charCodeAt(0)));
    case 3:
      return JSON.parse(JSON.stringify(text));
    default:
      return (text + "日").slice(0, text.length);
  }
}
function changedAt(text: string, index: number): string {
  return text.slice(0, index) + (text[index] === "#" ? "$" : "#") + text.slice(index + 1);
}

const map = new Map<string, number>();
const set = new Set<string>();
const stored: string[] = [];
for (const length of lengths) {
  for (let seed = 0; seed < 3; seed++) {
    const text = textOf(length, seed);
    if (!map.has(text)) stored.push(text);
    map.set(text, length * 10 + seed);
    set.add(text);
  }
}
const wide = ["é", "éa", "日本", "日本語のテキスト", "aé".repeat(9), "x".repeat(16) + "日"];
for (const text of wide) {
  stored.push(text);
  map.set(text, -text.length);
  set.add(text);
}

let found = 0;
let missed = 0;
const wrong: string[] = [];
for (const text of stored) {
  for (let way = 0; way < 5; way++) {
    const other = anotherStringOf(text, way);
    if (other !== text) wrong.push(`not the same text ${way} ${text.length}`);
    if (map.get(other) !== map.get(text) || !map.has(other) || !set.has(other)) wrong.push(`lost ${way} ${JSON.stringify(text)}`);
    else found++;
    const sizeBefore = map.size + set.size;
    map.set(other, map.get(text)!);
    set.add(other);
    if (map.size + set.size !== sizeBefore) wrong.push(`added again ${way} ${JSON.stringify(text)}`);
  }
  for (const index of [0, 1, 3, 4, 7, 8, text.length >> 1, text.length - 2, text.length - 1]) {
    if (index < 0 || index >= text.length) continue;
    const near = changedAt(text, index);
    if (map.has(near) || set.has(near) || map.get(near) !== undefined) wrong.push(`found a stranger ${index} ${JSON.stringify(text)}`);
    else missed++;
  }
  if (map.has(text + "~") || set.has(text + " ")) wrong.push(`found a longer text ${JSON.stringify(text)}`);
}
console.log(stored.length, map.size, set.size, found, missed, wrong.length, wrong.slice(0, 6).join(" | "));

let removed = 0;
for (let i = 0; i < stored.length; i += 2) {
  if (map.delete(anotherStringOf(stored[i], i % 5))) removed++;
  if (set.delete(anotherStringOf(stored[i], (i + 1) % 5))) removed++;
}
let left = 0;
for (const text of stored) if (map.has(anotherStringOf(text, 0)) && set.has(anotherStringOf(text, 4))) left++;
console.log(removed, left, map.size, set.size, [...map.keys()].slice(0, 6).join("|"), [...set].slice(-3).join("|"));
