
type Point = { x: number; y: number; label: string };
function describe(p: Point): string {
  let text = p.label + ":" + (p.x + p.y);
  if (p.x > p.y) text += " wide";
  if (p.label.length > 3) text += " long";
  return text;
}
function scale(p: Point, by: number): string {
  return describe({ x: p.x * by, y: p.y * by, label: p.label });
}
const table: Record<string, (p: any, by: number) => string> = { describe, scale };
const input = JSON.parse(process.argv[2] ?? '{"x":1,"y":2,"label":"a"}');
console.log(table[process.argv[3] ?? "scale"](input, 3));
