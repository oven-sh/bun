// The result of JSON.parse<T>() is a T when the call returns, with a reviver too, so later code reads its fields directly instead of by name.
// IR= 1 readsParsed : number = PropGet v\d+ name="x"(?!.* isFallback)
// IR= 1 readsParsed : number = PropGet v\d+ name="y"(?!.* isFallback)
// IR= 0 readsParsed ~number = PropGet(?!.* isFallback)
// IR= 0 readsParsed ~(undefined\|null\|)?L\d+
// IR= 1 readsRevived : number = PropGet v\d+ name="x"(?!.* isFallback)
// IR= 0 readsRevived ~number = PropGet(?!.* isFallback)
// IR= 1 readsKept : number = PropGet v\d+ name="y"(?!.* isFallback)
// IR= 0 readsKept ~number = PropGet(?!.* isFallback)
// IR= 1 readsGiven  = PropGet v\d+ name="from"(?!.* isFallback)
// VALIDATED compiles
import { JSON } from "bun"; interface Point { x: number; y: number }
interface Line { from: Point; to: Point; points: Point[]; name?: string }
interface GivenPoint { x: number; y: number }
interface GivenLine { from: GivenPoint }

const text = '{"from":{"x":1,"y":2},"to":{"x":3,"y":4},"points":[{"x":5,"y":6},{"x":7,"y":8.5}],"name":"n"}';
const kept = JSON.parse<Line>(text);

function readsParsed(from: string): number {
  const line = JSON.parse<Line>(from);
  let total = line.from.x;
  for (const point of line.points) total += point.y;
  return total;
}
let lastRevived: Line | undefined;
function readsRevived(from: string): number {
  const line = JSON.parse<Line>(from, (key, value) => (key === "x" ? value + 10 : value));
  lastRevived = line;
  return line.to.x;
}
function readsKept(): number {
  let total = 0;
  for (let i = 0; i < kept.points.length; i++) total += kept.points[i].y;
  return total;
}
function readsGiven(from: string): number {
  const line: GivenLine = globalThis.JSON.parse(from);
  return line.from.x;
}
let attempts = 0;
function caught(from: string): string {
  try {
    return String(JSON.parse<Line>(from).to.y);
  } catch (error) {
    return (error as Error).constructor.name;
  } finally {
    attempts++;
  }
}
console.log(readsParsed(text), readsRevived(text), readsKept(), readsGiven(text));
console.log(caught(text), caught("{"), caught('{"from":1}'), caught('{"\\u0066rom":{"x":1,"y":2},"to":{"x":3,"y":40},"points":[]}'), attempts);
kept.points.push({ x: 0, y: 100 });
kept.from = { x: -1, y: -2 };
console.log(readsKept(), kept.from.x, kept.name, Object.keys(kept).join());
console.log(JSON.parse<number[]>("[1,2.5]").reduce((sum, item) => sum + item, 0), JSON.parse<string>('"s"').length, JSON.parse<Point | null>("null"), JSON.parse<[number, Point]>('[1,{"x":2,"y":3}]')[1].y);
