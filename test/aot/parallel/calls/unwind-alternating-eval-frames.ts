// Compiled functions and functions created from text at run time call each other, so one unwind leaves and enters compiled code once per pair of frames, however deep the stack is.
// Alone: TODO: with it among the entry points the executable is not built at the first try
type Step = (depth: number) => number;

const lines: string[] = [];

let deepest = 0;
function descend(depth: number): number {
  deepest = depth;
  const result = evaluatedDescend(depth + 1);
  return result + 1;
}
const evaluatedDescend = new Function(
  "descend",
  "return function (depth) { var result = descend(depth + 1); return result + 1; };",
)(descend) as Step;

function overflow(round: number): string {
  const scaled = round * 1.5;
  const label = "round " + round;
  let outcome: string;
  try {
    outcome = "returned " + descend(0);
  } catch (error) {
    outcome = error instanceof RangeError ? "RangeError" : "another error: " + String(error);
  }
  return label + ": " + outcome + ", went deep: " + (deepest > 100) + ", " + scaled;
}
for (let round = 1; round <= 3; round++) {
  deepest = 0;
  lines.push(overflow(round));
}

const state = { bottom: 99, throws: true };
const counts = { compiled: 0, evaluated: 0 };
let step: Step = depth => depth;

function withFinally(depth: number): number {
  try {
    const result = step(depth + 1);
    return result + 1;
  } finally {
    counts.compiled++;
  }
}
function withoutHandler(depth: number): number {
  const result = step(depth + 1);
  return result + 1;
}

function createStep(compiled: Step, body: string): Step {
  return new Function("compiled", "state", "counts", "return function (depth) { " + body + " };")(compiled, state, counts) as Step;
}
const reachBottom = "if (depth === state.bottom) { if (state.throws) throw new Error('bottom ' + depth); return 0; }";
const bodies: Array<[string, string]> = [
  ["no handler", reachBottom + " var result = compiled(depth + 1); return result + 1;"],
  ["finally", "try { " + reachBottom + " var result = compiled(depth + 1); return result + 1; } finally { counts.evaluated++; }"],
  ["catch and rethrow", "try { " + reachBottom + " var result = compiled(depth + 1); return result + 1; } catch (error) { counts.evaluated++; throw error; }"],
];
const compiledFunctions: Array<[string, Step]> = [
  ["finally", withFinally],
  ["no handler", withoutHandler],
];

for (const [compiledName, compiled] of compiledFunctions) {
  for (const [evaluatedName, body] of bodies) {
    for (const throws of [true, false]) {
      state.throws = throws;
      counts.compiled = 0;
      counts.evaluated = 0;
      step = createStep(compiled, body);
      const before = compiledName.length * 0.25;
      let outcome: string;
      try {
        outcome = "returned " + compiled(0);
      } catch (error) {
        outcome = "caught " + (error as Error).message;
      }
      lines.push("compiled " + compiledName + ", evaluated " + evaluatedName + ": " + outcome + ", compiled " + counts.compiled + ", evaluated " + counts.evaluated + ", " + before);
    }
  }
}

console.log(lines.join("\n"));
export {};
