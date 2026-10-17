// The result of Bun.safeValidate<T>() is typed: after the test of `success`, `result.data` is a T and its fields are read directly.
// IR= 1 readsData \bnumber = GetById v\d+ "x"
// IR= 1 readsData \bnumber = GetById v\d+ "y"
// IR= 0 readsData ~number = GetById
// IR= 1 readsData : boolean = GetById v\d+ "success"
// IR= 1 readsData Point\.\d+ = GetById v\d+ "data"
// VALIDATED compiles
interface Point { x: number; y: number }
interface Line { from: Point; points: Point[]; name?: string }

function readsData(input: unknown): number {
  const result = Bun.safeValidate<Point>(input);
  if (!result.success) return -result.issues.length;
  return result.data.x + result.data.y;
}
function readsNested(input: unknown): string {
  const result = Bun.safeValidate<Line>(input);
  if (result.success) {
    let total = result.data.from.x;
    for (const point of result.data.points) total += point.y;
    return total + " " + result.data.name;
  }
  return result.issues.map(issue => issue.path.join(".") + ": " + issue.code).join("; ");
}
const received = (text: string): unknown => JSON.parse(text);
const kept = [Bun.safeValidate<Point>(received('{"x":1,"y":2}')), Bun.safeValidate<Point>(received('{"x":"1"}')), Bun.safeValidate<Point>(null)];
console.log(readsData(received('{"x":1,"y":2.5}')), readsData(received('{"x":1}')), readsData("x"), readsData(received('{"x":1,"y":2,"z":3}')));
console.log(readsNested(received('{"from":{"x":1,"y":2},"points":[{"x":0,"y":3},{"x":0,"y":4.5}],"name":"n"}')), "|", readsNested(received('{"from":{"x":1,"y":2},"points":[]}')), "|", readsNested(received('{"from":{"x":"1"},"points":[1],"name":2}')));
for (const result of kept) console.log(JSON.stringify(result), Object.keys(result).join(), result.success ? result.data.y : result.issues[0].message);
const { success, ...rest } = kept[0];
console.log(success, JSON.stringify(rest), "data" in kept[0], "issues" in kept[0], "data" in kept[1]);
