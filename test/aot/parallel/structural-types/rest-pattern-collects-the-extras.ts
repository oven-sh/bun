interface Point {
  x: number;
  y: number;
}

const log: string[] = [];

function withoutX(p: Point): { y: number } {
  const { x, ...rest } = p;
  log.push("x was " + x);
  return rest;
}

function withoutBoth(p: Point): {} {
  const { x, y, ...rest } = p;
  log.push("x + y was " + (x + y));
  return rest;
}

function parameterPattern({ y, ...rest }: Point): string {
  return y + " " + JSON.stringify(rest);
}

function renamed(p: Point): string {
  const { y: second, x: first } = p;
  return first + "," + second;
}

const tag = Symbol("tag");
const extras = { w: 0, x: 1, y: 2, z: 3 };
const flipped = { y: 5, x: 4 };
const getters = {
  get y(): number {
    log.push("get y");
    return 7;
  },
  extra: "extra",
  get x(): number {
    log.push("get x");
    return 6;
  },
};
const hidden = Object.defineProperty({ x: 8, y: 9, z: 10 }, "z", { enumerable: false });
const inherited: Point = Object.assign(Object.create({ y: 12, z: 13 }), { x: 11 });
const symbols = { [tag]: 1, x: 14, y: 15 };

class Pair {
  y = 17;
  x = 16;
  other = 18;
  method(): void {}
}

const table: [string, Point][] = [
  ["honest", { x: 0, y: 0 }],
  ["extras", extras],
  ["flipped", flipped],
  ["getters", getters],
  ["a hidden extra", hidden],
  ["y inherited", inherited],
  ["a symbol", symbols],
  ["an instance", new Pair()],
];

for (const [name, p] of table) {
  const rest = withoutX(p);
  console.log(name + ", without x: " + JSON.stringify(rest) + " keys " + Object.keys(rest).join() + " y " + rest.y);
  console.log(name + ", symbols kept: " + Object.getOwnPropertySymbols(rest).length);
  console.log(name + ", without both: " + JSON.stringify(withoutBoth(p)));
  console.log(name + ", parameter pattern: " + parameterPattern(p));
  console.log(name + ", renamed: " + renamed(p));
  console.log(name + ", log: " + log.join("; "));
  log.length = 0;
}

const local: Point = extras;
const { y, ...others } = local;
console.log("local: " + y + " " + JSON.stringify(others));

const list: Point[] = [extras, flipped, new Pair()];
console.log("elements: " + JSON.stringify(list.map(({ x, ...rest }) => rest)));

for (const { x, ...rest } of list) console.log("for-of pattern: " + x + " " + JSON.stringify(rest));

let a = 0;
let remaining: { y: number } = { y: 0 };
({ x: a, ...remaining } = local);
console.log("assignment pattern: " + a + " " + JSON.stringify(remaining));
