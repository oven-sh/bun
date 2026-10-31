// An outer loop puts lines together and an inner loop the cells of a line, each from what a function gives back. A turn of the inner loop replaces the function.
function mix(sum: number, next: number): number {
  return (sum * 31 + next * 8) | 0;
}
type Word = (x: number) => string;
function tagger(tag: string): Word {
  return x => tag + x;
}
function work(first: Word, second: Word, at: number, rows: number, cells: number): string {
  let word = first;
  let page = "";
  for (let row = 0; row < rows; row++) {
    let line = word(row) + ":";
    for (let cell = 0; cell < cells; cell++) {
      if (row * cells + cell === at) word = second;
      line += word(cell) + ";";
    }
    page += line + "|";
  }
  return page;
}
let total = 0;
for (let i = 0; i < 200; i++) total = mix(total, work(tagger("a" + i), tagger("second" + i), i % 13, 4, 3).length);
console.log(total, work(tagger("a"), tagger("b"), 4, 3, 2));
