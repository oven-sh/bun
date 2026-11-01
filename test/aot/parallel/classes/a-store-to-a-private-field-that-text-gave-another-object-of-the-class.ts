// A class in text that is given to eval hands its private field to one object of a class, or to one object written as a literal. Another object of that kind does not have
// the field: a store to it throws, as a read does, and gives it nothing.
function outcome(f: () => unknown): string {
  try {
    return String(f());
  } catch (e) {
    return "throws " + (e as Error).name;
  }
}
class Point {
  constructor(
    public x: number,
    public y: number,
  ) {}
}
const Field: any = (0, eval)(`(() => {
  class ReturnsArgument { constructor(o) { return o; } }
  return class Field extends ReturnsArgument {
    #stamp = "stamp";
    static read(o) { return o.#stamp; }
    static write(o, v) { o.#stamp = v; return "stored"; }
    static add(o, v) { o.#stamp += v; return "added"; }
    static has(o) { return #stamp in o; }
  };
})()`);
const kinds: [string, () => any][] = [
  ["an instance", () => new Point(1, 2)],
  ["a literal", () => ({ left: 1, right: "r" })],
];
for (const [kind, create] of kinds) {
  const stamped = create();
  new Field(stamped);
  const bare = create();
  console.log(kind, "without the field:", outcome(() => Field.write(bare, 1)), outcome(() => Field.add(bare, 1)), outcome(() => Field.read(bare)), Field.has(bare));
  console.log(kind, "with it:", outcome(() => Field.read(stamped)), outcome(() => Field.write(stamped, "again")), outcome(() => Field.read(stamped)), Field.has(stamped));
  // Behind reads and stores that found the field.
  for (let round = 0; round < 300; round++) {
    Field.write(stamped, round);
    Field.read(stamped);
  }
  const late = create();
  console.log(kind, "made later:", outcome(() => Field.write(late, 1)), outcome(() => Field.read(late)), Field.has(late));
  console.log(kind, "twice:", outcome(() => new Field(stamped)));
}
