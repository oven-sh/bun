// A TypeError quotes a chain that is written over several lines without its types: `!` at the end of a line and a cast in front of the chain.
type Inner = { second: { third: number } };
type Outer = { first?: Inner; make(): Outer };
function tell(label: string, run: () => unknown) {
  try {
    run();
    console.log(label + ": nothing thrown");
  } catch (error: any) {
    console.log(label + ": " + error.constructor.name + ": " + error.message + " | " + /:(\d+:\d+)\)?$/.exec(error.stack.split("\n")[1])![1]);
  }
}
function read(o: Outer) {
  return o
    .first!
    .second;
}
function readFromCast(o: unknown) {
  return (o as Outer)
    .first!
    .second
    .third;
}
function readFromResult(o: Outer): number {
  return o
    .make()
    .first!
    .second
    .third;
}
function readTwoChains(a: Outer, b: Outer) {
  return [
    a
      .first!
      .second,
    b
      .first!
      .second,
  ];
}
tell("read", () => read({} as Outer));
tell("cast", () => readFromCast({}));
tell("result", () => readFromResult({ make() { return {} as Outer; } }));
tell("the first of two chains", () => readTwoChains({} as Outer, { first: {} } as Outer));
tell("the second of two chains", () => readTwoChains({ first: {} } as Outer, {} as Outer));
