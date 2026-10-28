// `{ x: 1, y: 2 }` stands where a Point is declared, which the checker allows. In a literal of constants no operation stores it, so nothing said that such an object passes for a Point: the engine found
// data outside the type of `from` and took the type for a prediction, in every Line of the program. The same literal with one member that is no constant left the field typed.
// IR- layout .* name="Line" .*key="from" declared=\{type=[^}]*IsExpected
class Point { x = 0; y = 0 }
interface Line { from: Point; tag: number }
const line: Line = { from: { x: 1, y: 2 }, tag: 1 };
function makeLine(from: Point): Line { return { from, tag: 2 }; }
function fromOf(l: Line) { return l.from.x + l.from.y; }

const stranger: any = JSON.parse(process.argv[2] ?? "null");
let strange = 0;
if (stranger !== null) strange = fromOf(stranger) + fromOf(makeLine(stranger));

const point = new Point();
point.x = 3;
let sum = 0;
for (let i = 0; i < 3000; i++) sum += fromOf(i & 1 ? line : makeLine(point));
console.log(sum, strange, line.from instanceof Point, makeLine(point).from instanceof Point, JSON.stringify(line));
