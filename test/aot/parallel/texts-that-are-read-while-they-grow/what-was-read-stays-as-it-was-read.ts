// COUNT: operation:operationAOTStackStringBuilderToString >= 30
// Each text that was read is kept, and the builder goes on: no later part shows in an earlier text.
function prefixes(parts: string[]): string[] {
  const kept: string[] = [];
  let text = "";
  for (const part of parts) {
    text += part;
    kept.push(text);
    kept.push(text);
  }
  return kept;
}
const parts = ["α", "b", "γγ", "", "d", "𝒳", "e", "\ud83d", "\ude00", "f", "ζ", "0123456789", "η"];
const kept = prefixes([...parts, ...parts, ...parts]);
let joined = "";
let right = 0;
for (let at = 0; at < kept.length; at += 2) {
  joined += [...parts, ...parts, ...parts][at / 2];
  if (kept[at] === joined && kept[at + 1] === joined && kept[at].length === joined.length) right++;
}
console.log(right, kept.length, JSON.stringify(kept[9]), JSON.stringify(kept[kept.length - 1]));
