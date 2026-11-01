// A generic entrypoint emits the slow-path call of a string or object type check inline, so there is no late path or jump back, and on x86-64 the entrypoint falls through into the function.
// ENTRY-SIZE< oneString 36 20
// ENTRY-SIZE< oneObject 40 30
// ENTRY-SIZE< twoObjects 76 56
type Point = { x: number; y: number };
function oneString(s: string): number {
  return s.length;
}
function oneObject(p: Point): number {
  return p.x;
}
function twoObjects(p: Point, q: Point): number {
  return p.x + q.y;
}
const table: Record<string, Function> = { oneString, oneObject, twoObjects };
const point: Point = { x: 1, y: 2 };
for (const name of Object.keys(table)) {
  for (const given of name === "oneString" ? ["", "text", "a longer text".slice(2)] : [point, { x: 3, y: 4 }, { y: 5, x: 6 }, JSON.parse('{ "x": 7, "y": 8 }')]) console.log(name, table[name](given, given));
}
