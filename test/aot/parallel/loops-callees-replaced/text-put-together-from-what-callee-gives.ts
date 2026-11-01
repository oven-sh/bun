// A text is put together in a loop from what a function gives back. The function is replaced in the middle of the loop by one that captured another text.
function mix(sum: number, next: number): number {
  return (sum * 31 + next * 8) | 0;
}
type Word = (x: number) => string;
function tagger(tag: string): Word {
  return x => tag + x;
}
function work(first: Word, second: Word, at: number, n: number): string {
  let word = first;
  let text = word(0);
  for (let j = 1; j < n; j++) {
    if (j === at) word = second;
    text += "," + word(j);
  }
  return text;
}
let total = 0;
for (let i = 0; i < 400; i++) total = mix(total, work(tagger("a" + i), tagger("second" + i), i % 9, 8).length);
console.log(total, work(tagger("a"), tagger("b"), 2, 4), work(tagger("a"), String, 1, 3));
