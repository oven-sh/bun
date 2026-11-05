// STATISTIC: TypedResultsSelected = 1
// STATISTIC: ParsersCreated = 1
interface Point {
  x: number;
}

const point: Point = JSON.parse(process.argv[2] ?? '{"x":1.5}');
let sum = 0;
for (let i = 0; i < 1000; i++) sum += point.x;
console.log(sum);
