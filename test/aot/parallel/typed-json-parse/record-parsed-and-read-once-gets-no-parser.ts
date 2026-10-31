// STATISTIC: TypedResultsSelected = 0
// STATISTIC: ParsersCreated = 0
interface Point {
  x: number;
}
interface Line {
  from: Point;
  to: Point;
  label: string | null;
}

const point: Point = JSON.parse(process.argv[2] ?? '{"x":1}');
const holder = { a: point, b: 2 };
console.log(holder.a.x, holder.b);

const line: Line = JSON.parse('{"to":{"x":4},"from":{"x":3,"y":5},"label":null,"more":[1,2]}');
console.log(line.from.x, line.to.x, line.label, Object.keys(line).join(), JSON.stringify(line));

const notAPoint: Point = JSON.parse('{"x":"text"}');
console.log(typeof notAPoint.x, notAPoint.x);
