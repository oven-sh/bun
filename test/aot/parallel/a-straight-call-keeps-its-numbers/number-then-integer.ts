class Whole { size = 3; }
class Half { size = 0.5; }
type Piece = Whole | Half;
class Tag { n = 1; m = 2; }
const unseen = (x: any): any => [x][JSON.parse("0")];
const unit = new Whole();
const half = new Half();
function sizeOf(piece: Piece): number {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return piece.size * 2 + work;
}
function main() {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  function mix(ratio: number, steps: number): number {
    let work = 0;
    for (let i = 0; i < 2; i++) work = (work + i) | 0;
    return ratio * steps + work;
  }
  function weigh(tag: Tag): number {
    let work = 0;
    for (let i = 0; i < 2; i++) work = (work + tag.n + tag.m) | 0;
    return mix(0.25, unit.size) + work;
  }
  function weighLast(tag: Tag): number {
    let work = 0;
    for (let i = 0; i < 2; i++) work = (work + tag.n + tag.m) | 0;
    return mix(work / 8, unit.size);
  }
  const real = new Tag();
  let total = work - 1;
  for (let turn = 0; turn < 300; turn++) total += weigh(real) + weighLast(real);
  console.log(total, weigh(real), weighLast(real));
  const liar = unseen({ n: 1, m: 2 });
  console.log(weigh(liar), weighLast(liar));
}
console.log(sizeOf(unit), sizeOf(half));
main();
export {};
