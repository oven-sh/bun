// `best` is the unboxed result of a call with a landing on one way into the catch block and a boxed value on another, so the parameter of the handler block is boxed.
// ChooseRepresentations converts an argument of a handler right behind its definition (ConversionInserter::convertHandlerArgument, UseLists::pointAfter):
// between the call and the test of its form. The verifier then stops the build (InvalidLanding rule 1); without it code generation would (a landing nobody branched on).
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

function measure(p: Point, depth: number): number {
  return depth > 0 ? measure(p, depth - 1) + p.x : p.y;
}

function risky(flag: number): void {
  if (flag === 1) throw new Error("first");
  if (flag === 2) delete (victim as any).x;
}

let victim = new Point(0, 0);

function holder(p: Point, first: number, second: number, other: { weight: unknown }): string {
  let best: unknown = measure(p, 3);
  try {
    risky(first);
    best = other.weight;
    risky(second);
    best = "done";
  } catch (error) {
    return "caught " + best + " " + p.x + " " + p.y;
  }
  return best + " " + p.x + " " + p.y;
}

for (let round = 0; round < 300; round++) {
  victim = new Point(round, 1);
  const kind = round % 100;
  const line = holder(victim, kind === 97 ? 1 : kind === 99 ? 2 : 0, kind === 98 ? 1 : 0, { weight: kind === 98 ? "heavy" : round + 0.5 });
  if (kind >= 97 || round === 0) console.log(round + ": " + line);
}
