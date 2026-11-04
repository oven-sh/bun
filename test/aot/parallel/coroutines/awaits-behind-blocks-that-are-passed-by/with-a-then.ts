class Shape { kind: number; constructor(kind: number) { this.kind = kind; } then(done: (v: string) => void) { done("resolved " + this.kind); } }
class Box { shape: Shape; constructor(shape: Shape) { this.shape = shape; } }
async function other(): Promise<string> { return "other"; }
async function pick(box: Box) {
  const n = box.shape;
  const got = await ((n.kind === 1 || n.kind === 2) ? n : other());
  return typeof got + ":" + got;
}
let last = "";
for (let i = 0; i < 300; i++) last = await pick(new Box(new Shape(i % 4)));
console.log(last, await pick(new Box(new Shape(2))));
