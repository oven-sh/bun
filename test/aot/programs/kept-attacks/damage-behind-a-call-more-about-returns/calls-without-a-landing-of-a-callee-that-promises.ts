// `pick` declares a Point. A plain function calls it with a landing and relies on the type, so `pick` tests what it returns. The body of an async function, the body of a generator and a `try` block
// call it too, and their calls get no landing: there the swap finds nothing, a string comes back at the plain return point, and the caller's own test has to turn it away.
// WHAT TO LOOK AT BESIDE THE ANSWERS: on the tip the calls in the two coroutine bodies are fused with the test behind them (the callee tests, the caller does not). With clean returns on they are a call and a test again,
// and the callee goes on testing for the plain function's sake: two tests a call on a path that nothing ever leaves. Instructions with and without --aot-disable=CleanReturns.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

const odd: any = "odd";
let misfit = false;
const points: Point[] = [];
for (let index = 0; index < 8; index++) points.push(new Point(index, index * 2));

// It calls itself, so it stays a call.
function pick(n: number, depth: number): Point {
  if (depth > 0) return pick(n + 1, depth - 1);
  return misfit ? odd : points[n & 7];
}

function plain(n: number): string {
  const got = pick(n, 1);
  return typeof got + ":" + got.x;
}

async function asynchronous(n: number): Promise<string> {
  const got = pick(n, 1);
  const first = typeof got + ":" + got.x;
  await null;
  const again = pick(n + 1, 1);
  return first + "," + typeof again + ":" + again.y;
}

function* generator(n: number): Generator<string> {
  const got = pick(n, 1);
  yield typeof got + ":" + got.x;
  const again = pick(n + 1, 1);
  yield typeof again + ":" + again.y;
}

function underTry(n: number): string {
  try {
    const got = pick(n, 1);
    return typeof got + ":" + got.x;
  } catch (error) {
    return "caught";
  }
}

async function sumInAsyncBody(from: number, to: number): Promise<number> {
  let sum = 0;
  for (let n = from; n < to; n++) sum = (sum + pick(n, 1).x + pick(n, 2).y) % 1000003;
  return sum;
}

async function main(): Promise<void> {
  for (let round = 0; round < 300; round++) {
    misfit = round % 100 === 99;
    const line = plain(round) + " " + (await asynchronous(round)) + " " + [...generator(round)].join(",") + " " + underTry(round);
    if (misfit || round % 100 === 0) console.log(round + ": " + line);
  }
  misfit = false;
  let total = 0;
  for (let round = 0; round < 100; round++) total = (total + (await sumInAsyncBody(round, round + 10000))) % 1000003;
  console.log(total);
}

main();
