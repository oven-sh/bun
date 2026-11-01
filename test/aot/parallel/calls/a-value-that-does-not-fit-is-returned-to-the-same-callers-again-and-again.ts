// Flags: --aot-disable=InlineCalls
// COUNT: operation:operationAOTFindLandingOfMisfit <= 40
// Where a caller tests what a call returns right behind the call, the function promises the type, tests for itself, and hands what does not fit to the landing of a caller that has one and to any
// other caller as it is. Which of the two a caller is is looked up once: the run counts the lookups. Callers of both kinds, and values that fit between those that do not.
class Op {
  constructor(readonly tag: number) {}
  run(by: number): number {
    return this.tag * by;
  }
}
// What goes through it the build knows nothing about.
const hide = (0, eval)("x => x // ".slice(0, process.argv.length > 1000 ? 1 : 6)) as <T>(value: T) => T;
class Fiber {
  readonly stack: Array<Op> = [];
  skipped = 0;
  next(wanted: number): Op | undefined {
    while (true) {
      const op = this.stack.pop();
      if (!op) return undefined;
      if ((op as { skip?: boolean }).skip) {
        this.skipped++;
        continue;
      }
      if (wanted >= 0) return op;
    }
  }
}
const others: Array<Op> = hide([{ tag: 5, run: (by: number) => by + 1 }, { tag: 6, skip: true }, { tag: 7, run: (by: number) => by + 2 }] as unknown as Array<Op>);
function reliesOnIt(fiber: Fiber): number {
  const op = fiber.next(1);
  return op ? op.run(2) : -1;
}
function reliesOnItToo(fiber: Fiber): number {
  const op = fiber.next(2);
  return op === undefined ? -2 : op.tag;
}
function handsItOn(fiber: Fiber): unknown {
  return fiber.next(3);
}
function inATryBlock(fiber: Fiber): number {
  try {
    const op = fiber.next(4);
    return op!.run(3);
  } catch (error) {
    return (error as Error).name.length;
  }
}
const fiber = new Fiber();
let sum = 0;
const kinds = new Map<string, number>();
for (let i = 0; i < 6000; i++) {
  for (let k = 0; k < 5; k++) fiber.stack.push((i + k) % 3 ? others[(i + k) % others.length] : new Op(i % 11));
  sum += reliesOnIt(fiber) + reliesOnItToo(fiber) + inATryBlock(fiber);
  const handed = handsItOn(fiber);
  const kind = handed instanceof Op ? "an Op" : typeof handed;
  kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
  fiber.stack.length = 0;
}
console.log(sum, fiber.skipped, JSON.stringify([...kinds].sort()));
