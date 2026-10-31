// Substrings and concatenations as keys of a Set and a Map: found, added once, shared with equal keys, while the table grows.
const text = "the quick brown fox jumps over the lazy dog and the quick red fox runs past the lazy cat — naïve café";
const log = [];
function words(source) {
  const found = [];
  for (let start = 0; start < source.length; ) {
    let end = source.indexOf(" ", start);
    if (end < 0) end = source.length;
    found.push(source.slice(start, end));
    start = end + 1;
  }
  return found;
}
const set = new Set();
for (const word of words(text)) set.add(word);
log.push([...set].join("|"), set.size);
const counts = new Map();
for (const word of words(text)) counts.set(word, (counts.get(word) ?? 0) + 1);
log.push(JSON.stringify([...counts]));
const whole = new Set();
whole.add(text.slice(0)).add(text.slice(0, text.length)).add(text.substring(0, 3)).add("the").add(text.slice(4, 4));
log.push(whole.size, whole.has(text), whole.has("the"), whole.has(""));
const joined = new Set();
for (let i = 0; i < 300; i++) joined.add("key" + (i % 150));
for (let i = 0; i < 150; i++) if (!joined.has("ke" + "y" + i)) log.push("lost " + i);
log.push(joined.size);
const wide = "日本語のテキストと日本語の文字";
const units = new Set();
for (let i = 0; i + 2 <= wide.length; i++) units.add(wide.slice(i, i + 2));
log.push(units.size, units.has("日本"), units.has("本日"));
const narrowInWide = new Set(["ab"]);
narrowInWide.add(("ab" + "語").slice(0, 2));
log.push(narrowInWide.size);
const mixed = new Map([[1, "number"], ["1", "string"]]);
mixed.set("x1".slice(1), "substring").set(text.slice(0, 3) + 1, "rope");
log.push(JSON.stringify([...mixed]));
const deleted = new Set(words(text));
for (const word of words(text)) if (word.length === 3) deleted.delete(word);
for (const word of words(text)) if (word.length === 3) deleted.add(word.slice(0, 2));
log.push([...deleted].join("|"));
console.log(log.join("\n"));
