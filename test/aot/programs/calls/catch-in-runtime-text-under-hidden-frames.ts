// forEach is compiled and hidden from stack traces: runtime text catches a throw that crossed it, then keeps computing with restored registers.
type Point = { x: number; y: number };

const runtime: any = globalThis;

function scale(point: Point, factor: number): number {
  return point.x * factor + point.y;
}

runtime.scale = scale;

const text = `
  var point = { x: 3, y: 4 };
  var caught = "nothing";
  var sum = 0;
  try {
    [1, 2].forEach(callback);
  } catch (error) {
    caught = error.message;
  }
  for (var index = 0; index < 1000; index++) sum += index * 2 + point.x;
  var half = sum / 8;
  [caught, sum, half, point.y, scale(point, 2.5), scale({ x: sum, y: half }, 0.5)].join(" ");
`;

function runText(callbackBody: string): string {
  runtime.callback = new Function("value", callbackBody);
  return (0, eval)(text);
}

const throwingBodies = [
  'throw new RangeError("stopped at " + value);',
  'if (value === 2) throw new TypeError("stopped at " + value);',
  'if (value === 2) null.missing;',
];

for (let round = 0; round < 3; round++) {
  for (const body of throwingBodies) console.log(runText(body));
}

runtime.seen = 0;
for (let round = 0; round < 3; round++) {
  console.log(runText("seen += value * 10;"));
  console.log(runtime.seen);
}

let total = 0;
for (let round = 0; round < 100; round++) {
  total += runText(throwingBodies[round % 2]).length + scale({ x: round, y: 1 }, 2);
}
console.log(total);
