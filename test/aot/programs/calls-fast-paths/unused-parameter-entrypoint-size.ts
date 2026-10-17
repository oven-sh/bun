// The generic entrypoint does not type-check arguments for unused parameters. With nothing left to check, the entrypoint of a tiny function is its body and nothing more: it returns the number.
// ENTRY-SIZE< readsNone 9 12
// ENTRY-SIZE< readsTheString 48 56
// ENTRY-SIZE< readsTheNumber 48 8
type Point = { x: number; y: number };
function readsNone(a: number, p: Point, s: string): number {
  return 7;
}
function readsTheString(a: number, p: Point, s: string): number {
  return s.length;
}
function readsTheNumber(a: number, p: Point, s: string): number {
  return a * 2;
}
const table: Record<string, Function> = { readsNone, readsTheString, readsTheNumber };
for (const name of Object.keys(table)) console.log(name, table[name](21, { x: 1, y: 2 }, "text"), table[name](21, undefined, "text"));
