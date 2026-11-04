const unseen = (0, eval)("(x) => x");
class Shape { constructor(kind) { this.kind = kind; } }
class Box { constructor(shape) { this.shape = shape; } }
async function other() { return new Shape(0); }
async function pick(box) {
  const n = box.shape;
  const got = await ((n.kind === 1 || n.kind === 2) ? n : other());
  console.log("picked " + got.kind);
}
function start(kind) { pick(new Box(new Shape(kind))); }
start(unseen(2));
console.log("behind the call");
