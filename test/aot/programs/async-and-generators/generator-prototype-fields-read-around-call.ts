// The first call of a generator function after a store to its `prototype` property makes the stored object a prototype. Fields of that object are read before and after the call.
type Point = { x: number; y: number; label: string };
function* steps(): Generator<number> { yield 1; }
async function* asyncSteps(): AsyncGenerator<number> { yield 1; }

function readAroundCall(point: Point): string {
  (steps as any).prototype = point;
  const x = point.x;
  const generator = steps();
  return x + point.y + point.label + " " + (Object.getPrototypeOf(generator) === point);
}

function readAroundAsyncCall(point: Point): string {
  (asyncSteps as any).prototype = point;
  const x = point.x;
  const generator = asyncSteps();
  return x + point.y + point.label + " " + (Object.getPrototypeOf(generator) === point);
}

for (let i = 0; i < 4; i++) {
  console.log(readAroundCall({ x: i + 0.5, y: i * 2, label: "sync" + i }));
  console.log(readAroundAsyncCall({ x: i + 0.25, y: i * 3, label: "async" + i }));
}
