// A literal is covered by the type it is written under: that of a variable, a parameter, a result, an element or a field. Without any such type it is covered by the type that TypeScript infers for it. Plain Bun deletes.
// Columns: fields wide kinds types
function attempt(label: string, f: () => unknown) {
  try { console.log(label + ":", String(f())); } catch (e) { console.log(label + ":", (e as Error).constructor.name); }
}
interface Point { x: number; y: number }
function pass(point: Point): any { return point; }
function make(): Point { return { x: 1, y: 2 }; }
const inferred = () => ({ x: 1, y: 2 });
class Holder { point: Point = { x: 1, y: 2 } }
const makers: [string, () => any][] = [
  ["the type of a variable", () => { const p: Point = { x: 1, y: 2 }; return p; }],
  ["the type of a parameter", () => pass({ x: 1, y: 2 })],
  ["the type of a result", make],
  ["the type of an element", () => { const list: Point[] = [{ x: 1, y: 2 }]; return list[0]; }],
  ["the type of a field", () => new Holder().point],
  ["a type literal", () => { const p: { x: number; y: number } = { x: 1, y: 2 }; return p; }],
  ["no type at all", inferred],
  ["no type at all, in a variable", () => { const p = { x: 1, y: 2 }; return p; }],
];
for (const [how, make] of makers) {
  const o = make();
  attempt(how, () => delete o.x);
  console.log("  afterwards:", JSON.stringify(o));
}
