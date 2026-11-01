// The first alternative fails only behind more than fifty million turns of its group, fewer than the hundred million at which plain Bun gives a match up. The second matches at once.
// The texts are not known when the program is built, so the patterns are compiled when the program runs.
const nothing = String(Date.now()).slice(99);
for (const [text, length] of [["(?:a|a)*c|a+", 26], ["(a*)*c|a+", 27], ["(?:a||a)*c|a+", 26], ["(a+)+c|a+", 27]]) {
  const match = new RegExp(text + nothing).exec("a".repeat(length));
  console.log(text, length, match === null ? "null" : match[0].length);
}
