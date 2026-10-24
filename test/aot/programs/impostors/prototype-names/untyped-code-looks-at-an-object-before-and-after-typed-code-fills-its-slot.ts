// Twelve untyped ways to look for a property are each used 3000 times on objects whose declared optional field is absent: whatever they remember says "absent".
// Then typed code stores the field for the first time, on the very same objects, and the same twelve sites look again. Then typed code deletes it, and they look a third time.
const unknownCodeRuns = process.argv.length > 99;
function handOver(value: object) {
  if (unknownCodeRuns) (globalThis as any).hook?.(value);
}
interface Shape {
  id: number;
  x?: number;
  y?: string;
}
class Boxed implements Shape {
  id: number;
  x?: number;
  y?: string;
  constructor(id: number) {
    this.id = id;
    delete this.x;
    delete this.y;
    handOver(this);
  }
}
class Late implements Shape {
  declare id: number;
  declare x?: number;
  declare y?: string;
  constructor(id: number) {
    this.id = id;
    handOver(this);
  }
}
function setX(shape: Shape, value: number) {
  shape.x = value;
}
function dropX(shape: Shape) {
  delete shape.x;
}
const interpreted = new Function("o", JSON.parse('["return"," o",".x"]').join("")) as (object: object) => unknown;
const ways: [string, (object: any) => unknown][] = [
  ["by name", object => object.x],
  ["by key", object => object[["x"][0]]],
  ["in", object => "x" in object],
  ["hasOwn", object => Object.hasOwn(object, "x")],
  ["hasOwnProperty", object => object.hasOwnProperty("x")],
  ["keys", object => Object.keys(object).join("")],
  ["for-in", object => { let names = ""; for (const name in object) names += name; return names; }],
  ["json", object => JSON.stringify(object)],
  ["spread", object => JSON.stringify({ ...object })],
  ["a pattern", ({ x = "default" }) => x],
  ["a descriptor", object => JSON.stringify(Object.getOwnPropertyDescriptor(object, "x"))],
  ["Reflect.get", object => Reflect.get(object, "x")],
  ["entries", object => String(Object.entries(object))],
  ["interpreted", object => interpreted(object)],
];
function look(object: object) {
  return ways.map(([label, way]) => `${label} ${String(way(object))}`).join("; ");
}
const makers: [string, (id: number) => Shape][] = [
  ["a literal", id => { const made: Shape = { id }; handOver(made); return made; }],
  ["a class field that was deleted", id => new Boxed(id)],
  ["a field that is only declared", id => new Late(id)],
];
for (const [label, make] of makers) {
  const kept = make(1);
  let length = 0;
  for (let i = 0; i < 3000; i++) {
    const [, way] = ways[i % ways.length];
    length += String(way(kept)).length + String(way(make(i & 7))).length;
  }
  console.log(label, "| warm", length);
  console.log(label, "| absent:", look(kept));
  setX(kept, 5);
  console.log(label, "| stored:", look(kept));
  setX(kept, 6);
  console.log(label, "| stored again:", look(kept));
  dropX(kept);
  console.log(label, "| deleted:", look(kept));
  kept.y = "why";
  setX(kept, 7);
  console.log(label, "| stored behind another field:", look(kept));
  console.log(label, "| a fresh one:", look(make(2)));
}
