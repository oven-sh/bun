// Strings, record types, unions, classes, module variables and functions that several files mention are the same thing in each of them.
import { Circle, Shape, Square, area, describe, kinds, register, registry, total } from "./shapes";
import { Tagged, byTag, countOf, label, tags } from "./tags";
import { Ring, ringsMade, shrink } from "./rings";
import { basename } from "node:path";

type Either = Tagged | Shape | null;

function name(value: Either): string {
  if (value === null) return "nothing";
  if (value instanceof Shape) return describe(value);
  return label(value);
}

const shapes: Shape[] = [new Circle(2), new Square(3), new Ring(5, 1)];
for (const shape of shapes) register(shape);
console.log(shapes.map(name).join(" | "));
console.log(registry.size, total(), kinds.join(","));
console.log(area(shrink(new Ring(4, 2))).toFixed(3), ringsMade());

const tagged: Tagged[] = [
  { tag: "circle", weight: 1 },
  { tag: "square", weight: 2, note: "flat" },
  { tag: "circle", weight: 3 },
];
for (const one of tagged) byTag(one);
console.log(countOf("circle"), countOf("square"), countOf("ring"), tags().join(","));
console.log([null, tagged[1], shapes[2]].map(name).join(" | "));
console.log(basename("/a/b/shared.ts"), [...registry.keys()].sort().join(","));
