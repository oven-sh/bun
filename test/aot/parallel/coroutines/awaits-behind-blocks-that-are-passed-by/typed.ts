class Shape { kind: number; constructor(kind: number) { this.kind = kind; } }
class Box { shape: Shape; constructor(shape: Shape) { this.shape = shape; } }
async function other(): Promise<Shape> { return new Shape(0); }
const log: string[] = [];
async function pick(box: Box) {
  const n = box.shape;
  const got = await ((n.kind === 1 || n.kind === 2) ? n : other());
  log.push("picked " + got.kind);
}
function start(kind: number) { pick(new Box(new Shape(kind))); log.push("behind " + kind); }
for (let i = 0; i < 300; i++) start(i % 4);
await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
console.log(log.slice(0, 8).join(" | "));
console.log(log.length);
