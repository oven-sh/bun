import type { GeneratePair } from "../../pair";

const classCount = 64;

const declareClass = (index: number, marker = "") =>
  `class Shape${index} implements Shape { constructor(public area: number) {} name() { return "shape${index}"; } }${marker}`;

const generate: GeneratePair = () => {
  const indexes = Array.from({ length: classCount }, (_, index) => index);
  const lines = [
    "// CLIFF: C205",
    "interface Shape { area: number; name(): string }",
    "function totalArea(shapes: Shape[]): number {",
    "  let total = 0;",
    "  for (const shape of shapes) total += shape.area;",
    "  return total;",
    "}",
    ...indexes.map(index => declareClass(index)),
    declareClass(classCount, " // trigger"),
    "const shapes: Shape[] = [];",
    ...indexes.map(index => `shapes.push(new Shape${index}(${index}));`),
    `shapes.push(new Shape${classCount}(${classCount})); // trigger`,
    "console.log(totalArea(shapes));",
  ];
  return { "main.ts": lines.join("\n") + "\n" };
};

export default generate;
