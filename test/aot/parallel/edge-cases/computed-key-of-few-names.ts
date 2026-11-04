// `{ [key]: value }` where the key is one of a few names, a number beside a name, or a symbol that may be missing: the property is defined under that key and no other.
export {};

type Name = "first" | "second";

const tag = Symbol("tag");
const steps: string[] = [];

function show(made: object): string {
  return Reflect.ownKeys(made)
    .map(key => String(key) + "=" + String((made as Record<PropertyKey, unknown>)[key]))
    .join();
}

function alone(key: Name, value: number) {
  return { [key]: value };
}

function between(key: Name, value: number) {
  return { before: 0, [key]: value, after: 1 };
}

function overWritten(key: Name) {
  return { first: "written", [key]: "computed", second: "written last" };
}

function readBack(key: Name, value: number) {
  const made = { [key]: value };
  return String(made["first"]) + "," + String(made["second"]) + "," + String(made[key]);
}

function indexOrName(key: number | "size", value: string) {
  return { [key]: value };
}

function symbolOrNothing(key: typeof tag | undefined, value: string) {
  return { [key as typeof tag]: value };
}

function inOrder(key: Name) {
  return {
    [(steps.push("key"), key)]: (steps.push("value"), 1),
    [(steps.push("second key"), "other")]: (steps.push("second value"), 2),
  };
}

function belowSetter(key: Name) {
  const seen: string[] = [];
  const made = {
    __proto__: {
      set first(value: string) {
        seen.push("setter got " + value);
      },
    },
    [key]: "defined",
  };
  return show(made) + " " + seen.length;
}

console.log(show(alone("first", 1)), show(alone("second", 2)));
console.log(show(between("first", 1)), show(between("second", 2)));
console.log(show(overWritten("first")), show(overWritten("second")));
console.log(readBack("first", 1), readBack("second", 2));
console.log(show(indexOrName(3, "index")), show(indexOrName("size", "name")), show(indexOrName(-0, "minus zero")));
console.log(show(indexOrName(1.5, "fraction")), show(indexOrName(NaN, "not a number")), show(indexOrName(4294967295, "past the indexes")));
console.log(show(symbolOrNothing(tag, "symbol")), show(symbolOrNothing(undefined, "nothing")));
console.log(show(inOrder("second")), steps.join());
console.log(belowSetter("first"), belowSetter("second"));

// Keys that the written type leaves out.
const converted = {
  toString() {
    steps.push("converted");
    return "first";
  },
};
console.log(show(alone("third" as unknown as Name, 3)), show(alone("__proto__" as unknown as Name, 4)));
console.log(show(alone(undefined as unknown as Name, 5)), show(alone(7 as unknown as Name, 6)));
console.log(show(alone(converted as unknown as Name, 7)), steps[steps.length - 1]);
