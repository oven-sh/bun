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
  function mix(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, steps: number): number { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return a + b * 2 + c * 3 + d * 4 + e * 5 + f * 6 + g * 7 + h * 8 + i * 9 + steps * 1000 + work; }
  function weigh(tag: Tag): number { let work = 0; for (let i = 0; i < 2; i++) work = (work + tag.n + tag.m) | 0; return mix(0.25, 0.5, 0.75, 1.25, 1.5, 1.75, 2.25, 2.5, 2.75, unit.size) + work; }
  const real = new Tag();
  let total = work - 1;
  for (let turn = 0; turn < 300; turn++) total += weigh(real);
  console.log(total);
  const liar = unseen({ n: 1, m: 2 });
  let slow = 0;
  for (let turn = 0; turn < 1; turn++) slow += weigh(liar);
  console.log(slow);
}
console.log(sizeOf(unit), sizeOf(half));
main();
export {};
