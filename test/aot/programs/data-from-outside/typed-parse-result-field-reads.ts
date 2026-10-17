// The result of Bun.parse<T>() and Bun.validate<T>() is allocated as a T by the call, so later code reads its fields directly instead of by name.
// IR= 1 readsParsed : number = GetById v\d+ "x"
// IR= 1 readsParsed : number = GetById v\d+ "y"
// IR= 0 readsParsed ~number = GetById
// IR= 0 readsParsed ~undefined\|null\|Point
// IR= 1 readsValidated : number = GetById v\d+ "x"
// IR= 0 readsValidated ~number = GetById
// IR= 1 readsKept : number = GetById v\d+ "y"
// IR= 0 readsKept ~number = GetById
// IR= 1 readsGiven object = GetById v\d+ "from"
// IR= 0 readsGiven GivenPoint
// VALIDATED compiles
interface Point { x: number; y: number }
interface Line { from: Point; to: Point; points: Point[]; name?: string }
interface GivenPoint { x: number; y: number }
interface GivenLine { from: GivenPoint }

const text = '{"from":{"x":1,"y":2},"to":{"x":3,"y":4},"points":[{"x":5,"y":6},{"x":7,"y":8.5}],"name":"n"}';
const kept = Bun.parse<Line>(text);

function readsParsed(from: string): number {
  const line = Bun.parse<Line>(from);
  let total = line.from.x;
  for (const point of line.points) total += point.y;
  return total;
}
let lastValidated: Line | undefined;
function readsValidated(from: unknown): number {
  const line = Bun.validate<Line>(from);
  lastValidated = line;
  return line.to.x;
}
function readsKept(): number {
  let total = 0;
  for (let i = 0; i < kept.points.length; i++) total += kept.points[i].y;
  return total;
}
function readsGiven(from: string): number {
  const line: GivenLine = JSON.parse(from);
  return line.from.x;
}
let attempts = 0;
function caught(from: string): string {
  try {
    return String(Bun.parse<Line>(from).to.y);
  } catch (error) {
    return (error as Error).constructor.name;
  } finally {
    attempts++;
  }
}
console.log(readsParsed(text), readsValidated(JSON.parse(text)), readsKept(), readsGiven(text));
console.log(caught(text), caught("{"), caught('{"from":1}'), caught('{"\\u0066rom":{"x":1,"y":2},"to":{"x":3,"y":40},"points":[]}'), attempts);
kept.points.push({ x: 0, y: 100 });
kept.from = { x: -1, y: -2 };
console.log(readsKept(), kept.from.x, kept.name, Object.keys(kept).join());
console.log(Bun.parse<number[]>("[1,2.5]").reduce((sum, item) => sum + item, 0), Bun.parse<string>('"s"').length, Bun.parse<Point | null>("null"), Bun.parse<[number, Point]>('[1,{"x":2,"y":3}]')[1].y);
