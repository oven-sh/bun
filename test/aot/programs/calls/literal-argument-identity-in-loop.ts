// An object literal that is passed to a typed parameter on every iteration of a loop stays one object: each call sees the stores of the call before it.
const opaque = new Function("value", "return value") as <T>(value: T) => T;
type Counter = { n: number };
const seen = new Set<unknown>();
function tick(counter: Counter): number {
  seen.add(counter);
  counter.n++;
  return counter.n;
}
function skip(counter: Counter): number {
  seen.add(counter);
  return -counter.n;
}
let predicted: (counter: Counter) => number = tick;
if (opaque(false)) predicted = skip;
function report(label: string, results: number[], last: number): void {
  console.log(label + ": " + results.join(" ") + ", last " + last + ", objects " + seen.size);
  seen.clear();
}
function predictedCallee(): void {
  const literal: any = { n: 0 };
  const results: number[] = [];
  for (let i = 0; i < 3; i++) results.push(predicted(literal));
  report("predicted callee", results, literal.n);
}
function knownCallee(): void {
  const literal: any = { n: 0 };
  const results: number[] = [];
  for (let i = 0; i < 3; i++) results.push(tick(literal));
  report("known callee", results, literal.n);
}
function typedLiteral(): void {
  const literal: Counter = { n: 0 };
  const results: number[] = [];
  for (let i = 0; i < 3; i++) results.push(predicted(literal));
  report("typed literal", results, literal.n);
}
function widerLiteral(): void {
  const literal = { n: 0, extra: "kept" };
  const results: number[] = [];
  for (let i = 0; i < 3; i++) results.push(predicted(literal));
  report("wider literal, " + literal.extra, results, literal.n);
}
function nestedLoops(): void {
  const results: number[] = [];
  let last = 0;
  for (let outer = 0; outer < 2; outer++) {
    const literal: any = { n: 10 * outer };
    for (let i = 0; i < 3; i++) results.push(predicted(literal));
    last = literal.n;
  }
  report("nested loops", results, last);
}
function whileLoop(): void {
  const literal: any = { n: 0 };
  const results: number[] = [];
  while (predicted(literal) < 3) results.push(literal.n);
  report("while loop", results, literal.n);
}
function literalPerIteration(): void {
  const results: number[] = [];
  for (let i = 0; i < 3; i++) results.push(predicted({ n: i }));
  report("a literal per iteration", results, -1);
}
const atTopLevel: any = { n: 0 };
const topLevelResults: number[] = [];
for (let i = 0; i < 3; i++) topLevelResults.push(predicted(atTopLevel));
report("top level", topLevelResults, atTopLevel.n);
for (let round = 0; round < 2; round++) {
  predictedCallee();
  knownCallee();
  typedLiteral();
  widerLiteral();
  nestedLoops();
  whileLoop();
  literalPerIteration();
}
