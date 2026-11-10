class Box {
  constructor(public size: number) {}
  grown(by: number): number { return this.size + by; }
}
class Crate extends Box {
  grown(by: number): number { return super.grown(by) * 10; }
}
const grow = (box: Box, by: number) => box.grown(by);
function total(box: Box, by: number): number {
  const first = grow(box, by);
  return first + box.size;
}
const box = new Box(2), crate = new Crate(3);
console.log(total(box, 1), total(crate, 1));
(box as any).grown = function (this: Box, by: number) { return this.size - by; };
console.log(total(box, 1), total(crate, 1));
delete (box as any).grown;
Box.prototype.grown = function (by: number) { return this.size * by; };
console.log(total(box, 5), total(crate, 5));
Object.setPrototypeOf(crate, { grown: () => 100 });
console.log(total(box, 5), total(crate, 5));
