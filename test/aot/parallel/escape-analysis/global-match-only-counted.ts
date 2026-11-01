// Only the length of the list of matches is read, so no list is made.
// COUNT: allCells <= 20000
const sentences = ["The quick brown fox", "rhythm", "aeiou AEIOU", "jumps over the lazy dog"];
function vowels(i: number): number {
  return sentences[i & 3]!.match(/[aeiou]/gi)?.length ?? 0;
}
let sum = 0;
for (let i = 0; i < 70000; i++) sum += vowels(i);
console.log(sum);
