// The rows of an edit distance: `const next = [i]`, filled by push from its end under a counter that enters as 1, and read one place behind the push in the same turn. Texts of many lengths, the empty one, rows past 25 and past 100.
function distance(a, b) {
  let row = [];
  for (let j = 0; j <= b.length; j++) row.push(j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      next.push(Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + cost));
    }
    row = next;
  }
  return row[b.length];
}
const table = { distance };
const texts = JSON.parse('["", "a", "kitten", "sitting", "abcdefghijklmnopqrstuvwxyz", "zyxwvutsrqponmlkjihgfedcba0123456789"]');
texts.push("ab".repeat(70), "ba".repeat(64) + "c");
const said = [];
for (let turn = 0; turn < 2; turn++) for (const a of texts) for (const b of texts) said.push(table[JSON.parse('"distance"')](a, b));
console.log(said.join(" "));
