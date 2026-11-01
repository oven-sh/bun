// Lists that a loop fills by index up to the length of a string: empty, short and long strings, strings that are joined late, and a loop that ends early.
const out: string[] = [];
function row(first: number, text: string): number[] {
  const current = [first];
  for (let c = 1; c <= text.length; c++) current[c] = current[c - 1]! + text.charCodeAt(c - 1);
  return current;
}
function codes(text: string): number[] {
  const list: number[] = [];
  for (let c = 0; c < text.length; c++) list[c] = text.charCodeAt(c);
  return list;
}
function untilSpace(text: string): string[] {
  const list: string[] = [];
  for (let c = 0; c < text.length; c++) {
    if (text[c] === " ") break;
    list[c] = text[c]!;
  }
  return list;
}
function distance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, k) => k);
  for (let r = 1; r <= a.length; r++) {
    const current = [r];
    for (let c = 1; c <= b.length; c++) current[c] = Math.min(previous[c]! + 1, current[c - 1]! + 1, previous[c - 1]! + (a[r - 1] === b[c - 1] ? 0 : 1));
    previous = current;
  }
  return previous[b.length]!;
}
const joined = ["ab", "cd", "ef"].join("") + String(out.length);
for (const text of ["", "a", "kitten", joined, "é世😀", "x".repeat(3000)]) {
  const made = row(7, text);
  out.push(`${text.length}: ${made.length} ${made[made.length - 1]} ${codes(text).length} ${codes(text).slice(0, 4)}`);
}
out.push(`${untilSpace("one two")} ${untilSpace("").length} ${untilSpace(" x").length}`);
out.push(`${distance("kitten", "sitting")} ${distance("", "abc")} ${distance("abc", "")} ${distance("saturday", "sunday")}`);
console.log(out.join("\n"));
