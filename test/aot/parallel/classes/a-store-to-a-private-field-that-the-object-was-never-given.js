// A class whose parent answers its argument gives its private field to one object. Another object of that kind lacks the field, and every store to it throws.
function outcome(f) {
  try {
    return String(f());
  } catch (e) {
    return "throws " + e.name;
  }
}
class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}
class ReturnsArgument {
  constructor(o) {
    return o;
  }
}
class Field extends ReturnsArgument {
  #stamp;
  static read(o) {
    return o.#stamp;
  }
  static has(o) {
    return #stamp in o;
  }
  static store(o, v) {
    o.#stamp = v;
    return "stored";
  }
  static destructure(o, v) {
    [o.#stamp] = [v];
    return "stored";
  }
  static add(o, v) {
    o.#stamp += v;
    return "stored";
  }
  static storeIfNullish(o, v) {
    o.#stamp ??= v;
    return "stored";
  }
  static storeThenReadAnother(o, v, another) {
    o.#stamp = v;
    return another.#stamp;
  }
  static readAnotherThenStore(o, v, another) {
    const found = another.#stamp;
    o.#stamp = v;
    return found;
  }
}
const kinds = [
  ["an instance", () => new Point(1, 2)],
  ["a literal", () => ({ left: 1, right: "r" })],
];
const ways = ["store", "destructure", "add", "storeIfNullish", "storeThenReadAnother", "readAnotherThenStore"];
for (const [kind, create] of kinds) {
  for (const way of ways) {
    const given = create();
    const another = create();
    new Field(given);
    new Field(another);
    const bare = create();
    console.log(
      kind,
      way,
      "without the field:",
      outcome(() => Field[way](bare, "v", another)),
      outcome(() => Field.read(bare)),
      Field.has(bare),
    );
    console.log(
      kind,
      way,
      "with it:",
      outcome(() => Field[way](given, "v", another)),
      outcome(() => Field.read(given)),
      Field.has(given),
    );
    console.log(
      kind,
      way,
      "reads one without it:",
      outcome(() => Field[way](given, "w", bare)),
      outcome(() => Field.read(given)),
      Field.has(bare),
    );
  }
}
