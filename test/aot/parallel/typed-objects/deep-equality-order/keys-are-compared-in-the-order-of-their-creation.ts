// Bun.deepEquals compares the properties of two objects in the order in which those of the first were created, symbol keys among the names. A getter on each value says when it is read, or throws.
export {};

const first = Symbol("first");
const third = Symbol("third");
const fifth = Symbol("fifth");
const log: string[] = [];
const leaf = (name: string) => ({
  get read() {
    log.push(name);
    return 1;
  },
});
const thrower = (name: string) => ({
  get read(): number {
    throw new Error(name);
  },
});
function tell(label: string, run: () => unknown) {
  log.length = 0;
  let answer: string;
  try {
    answer = String(run());
  } catch (error) {
    answer = "throws " + (error as Error).message;
  }
  console.log(label + ": " + answer + " | " + log.join(" "));
}
// A name that the build cannot read.
const atRunTime = (name: string) => (Math.random() < 2 ? name : "");

const literal = () => ({
  [first]: leaf("first"),
  second: leaf("second"),
  [third]: leaf("third"),
  fourth: leaf("fourth"),
});
tell("a literal", () => Bun.deepEquals(literal(), literal()));
tell("a literal, strict", () => Bun.deepEquals(literal(), literal(), true));
tell("a literal in a list", () => Bun.deepEquals([literal()], [literal()], true));
tell("a literal in a Map", () => Bun.deepEquals(new Map([[1, literal()]]), new Map([[1, literal()]]), true));
tell("a literal in a Set", () => Bun.deepEquals(new Set([literal()]), new Set([literal()])));
tell("a literal in a literal", () =>
  Bun.deepEquals({ [first]: literal(), second: literal() }, { [first]: literal(), second: literal() }),
);

class Stored {
  [first]: object;
  second: object;
  [third]: object;
  fourth: object;
  constructor() {
    this[first] = leaf("first");
    this.second = leaf("second");
    this[third] = leaf("third");
    this.fourth = leaf("fourth");
  }
}
tell("an instance that its constructor fills", () => Bun.deepEquals(new Stored(), new Stored()));
tell("an instance that its constructor fills, strict", () => Bun.deepEquals(new Stored(), new Stored(), true));

class Declared {
  [first] = leaf("first");
  second = leaf("second");
  [third] = leaf("third");
  fourth = leaf("fourth");
}
tell("an instance with declared fields", () => Bun.deepEquals(new Declared(), new Declared()));
tell("an instance with declared fields, strict", () => Bun.deepEquals(new Declared(), new Declared(), true));

class Heir extends Declared {
  [fifth] = leaf("fifth");
  sixth = leaf("sixth");
}
tell("an instance of a subclass", () => Bun.deepEquals(new Heir(), new Heir()));
tell("an instance of a subclass, strict", () => Bun.deepEquals(new Heir(), new Heir(), true));

function grown() {
  const object: Record<string | symbol, object> = { zeroth: leaf("zeroth") };
  object[first] = leaf("first");
  object.second = leaf("second");
  return object;
}
tell("keys stored after the literal", () => Bun.deepEquals(grown(), grown()));
tell("keys stored after the literal, strict", () => Bun.deepEquals(grown(), grown(), true));

function named() {
  const object: Record<string | symbol, object> = { [first]: leaf("first"), second: leaf("second") };
  object[atRunTime("later")] = leaf("later");
  object[third] = leaf("third");
  return object;
}
tell("a name made at run time", () => Bun.deepEquals(named(), named()));
tell("a name made at run time, strict", () => Bun.deepEquals(named(), named(), true));

function stoodFirst() {
  const object: Record<string | symbol, object> = { second: leaf("second"), [first]: leaf("first") };
  delete object.second;
  object.second = leaf("second");
  return object;
}
tell("a name deleted and stored again", () => Bun.deepEquals(stoodFirst(), stoodFirst()));
tell("a name deleted and stored again, strict", () => Bun.deepEquals(stoodFirst(), stoodFirst(), true));

tell("a spread", () => Bun.deepEquals({ ...literal() }, { ...literal() }));
tell("a spread, strict", () => Bun.deepEquals({ ...literal() }, { ...literal() }, true));
tell("Object.assign", () => Bun.deepEquals(Object.assign({}, literal()), Object.assign({}, literal())));
tell("Object.assign, strict", () => Bun.deepEquals(Object.assign({}, literal()), Object.assign({}, literal()), true));

const symbolFirst = (side: string) => ({ [first]: leaf(side + ".first"), second: leaf(side + ".second") });
const nameFirst = (side: string) => ({ second: leaf(side + ".second"), [first]: leaf(side + ".first") });
tell("the symbol first on the left only", () => Bun.deepEquals(symbolFirst("left"), nameFirst("right")));
tell("the symbol first on the right only", () => Bun.deepEquals(nameFirst("left"), symbolFirst("right")));
tell("the symbol first on the left only, strict", () => Bun.deepEquals(symbolFirst("left"), nameFirst("right"), true));
tell("the symbol first on the right only, strict", () => Bun.deepEquals(nameFirst("left"), symbolFirst("right"), true));

const listed = (side: string) =>
  Object.fromEntries([
    [first, leaf(side + ".first")],
    ["second", leaf(side + ".second")],
  ]);
tell("a literal against an object made by Object.fromEntries", () =>
  Bun.deepEquals(nameFirst("left"), listed("right")),
);
tell("an object made by Object.fromEntries against a literal", () =>
  Bun.deepEquals(listed("left"), nameFirst("right")),
);
tell("a literal against an object made by Object.fromEntries, strict", () =>
  Bun.deepEquals(nameFirst("left"), listed("right"), true),
);
tell("an object made by Object.fromEntries against a literal, strict", () =>
  Bun.deepEquals(listed("left"), nameFirst("right"), true),
);

const throwing = () => ({ [first]: thrower("the symbol"), second: thrower("the name") });
tell("getters that throw", () => Bun.deepEquals(throwing(), throwing()));
tell("getters that throw, strict", () => Bun.deepEquals(throwing(), throwing(), true));
class Throwing {
  [first] = thrower("the symbol");
  second = thrower("the name");
}
tell("getters that throw in an instance", () => Bun.deepEquals(new Throwing(), new Throwing()));
tell("getters that throw in an instance, strict", () => Bun.deepEquals(new Throwing(), new Throwing(), true));
tell("a difference behind a getter that throws", () =>
  Bun.deepEquals({ [first]: thrower("the symbol"), second: 1 }, { [first]: thrower("the symbol"), second: 2 }),
);
tell("a difference in front of a getter that throws", () =>
  Bun.deepEquals({ second: 1, [first]: thrower("the symbol") }, { second: 2, [first]: thrower("the symbol") }),
);
