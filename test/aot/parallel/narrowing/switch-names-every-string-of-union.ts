// A switch that names every string of a union takes its last case for whatever the others let pass. A string joined at run time takes its case, and a value from outside that is none of the strings takes none.
type Kind = "circle" | "square" | "box";
type Shape = { kind: Kind; size: number };

function byParameter(kind: Kind, size: number): number | string {
  switch (kind) {
    case "circle":
      return size * 3;
    case "square":
      return size * size;
    case "box":
      return size + size;
  }
  return "none of the three";
}

function byField(shape: Shape): number | string {
  switch (shape.kind) {
    case "circle":
      return shape.size * 3;
    case "square":
      return shape.size * shape.size;
    case "box":
      return shape.size + shape.size;
  }
  return "none of the three";
}

function withoutAnEnd(shape: Shape): number {
  switch (shape.kind) {
    case "circle":
      return shape.size * 3;
    case "square":
      return shape.size * shape.size;
    case "box":
      return shape.size + shape.size;
  }
}

function assigned(kind: Kind): string {
  let name: string;
  switch (kind) {
    case "box":
      name = "a " + kind;
      break;
    case "circle":
    case "square":
      name = "one " + kind;
      break;
  }
  return name;
}

const kinds: Kind[] = ["circle", "square", "box"];
for (let round = 0; round < 3; round++) {
  for (const kind of kinds) {
    console.log(
      kind,
      byParameter(kind, round + 2),
      byField({ kind, size: round + 2 }),
      withoutAnEnd({ kind, size: round + 2 }),
      assigned(kind),
    );
  }
}

const joined = ["cir", "cle"].join("") as Kind;
console.log(
  byParameter(joined, 5),
  byField({ kind: joined, size: 5 }),
  withoutAnEnd({ kind: joined, size: 5 }),
  assigned(joined),
);

const other: any = JSON.parse('"hexagon"');
console.log(
  byParameter(other, 5),
  byField({ kind: other, size: 5 }),
  withoutAnEnd({ kind: other, size: 5 }),
  assigned(other),
);
const parsed: Shape = JSON.parse('{"kind":"hexagon","size":7}');
console.log(byField(parsed), withoutAnEnd(parsed));
const noString: any = JSON.parse("[1, null, {}]");
for (const value of noString)
  console.log(
    byParameter(value, 5),
    byField({ kind: value, size: 5 }),
    withoutAnEnd({ kind: value, size: 5 }),
    assigned(value),
  );
