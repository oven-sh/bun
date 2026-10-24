// A function that leaves early hands back what it was handed. Its caller tests the result of the call for its declared type: what the early return hands back has that type already,
// what the whole function hands back may be anything.
class Shape {
  flags: number;
  next: Shape | undefined;
  constructor(flags: number, next?: Shape) {
    this.flags = flags;
    this.next = next;
  }
}

const answers: unknown[] = [];
let turn = 0;

function reduceSlowly(shape: Shape): Shape {
  const answer = answers[turn++ % answers.length];
  return answer as Shape;
}

function reduce(shape: Shape): Shape {
  if (shape.flags & 1) return reduceSlowly(shape);
  return shape;
}

function flagsOf(shape: Shape): unknown {
  return shape === undefined || shape === null ? "none" : shape.flags;
}

function describe(shape: Shape): unknown {
  return flagsOf(reduce(shape));
}

function nextOrSelf(shape: Shape): Shape | undefined {
  if (shape.flags & 2) return shape.next;
  return shape;
}

function describeNext(shape: Shape): unknown {
  const next = nextOrSelf(shape);
  return next ? flagsOf(next) : "nothing";
}

const plain = new Shape(4);
const slow = new Shape(5);
const linked = new Shape(2, plain);
const unlinked = new Shape(2);
answers.push(plain, "a text", 7, undefined, null, { flags: "of a stranger" }, slow, [1, 2], () => 1);

const seen = new Map<string, number>();
for (let round = 0; round < 20000; round++) {
  for (const shape of [plain, slow, linked, unlinked]) {
    const line = String(describe(shape)) + " | " + String(describeNext(shape));
    seen.set(line, (seen.get(line) ?? 0) + 1);
  }
}
for (const [line, count] of [...seen].sort()) console.log(line, count);

delete (plain as any).flags;
console.log(describe(plain), describeNext(plain), describeNext(linked));
Object.defineProperty(slow, "flags", { get() { return 4; } });
console.log(describe(slow), describeNext(slow));
