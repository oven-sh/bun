// `[Key, Held]` is what the checker says of the head. What is stepped to in between is a set, a text, a generator, a list with a way of its own to be stepped through, a list that is too short, and no iterable at all.
const show = (value: any): string => {
  try {
    return Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : typeof value === "string" ? JSON.stringify(value) : typeof value === "function" ? "function" : String(value);
  } catch (error) {
    return "cannot be shown";
  }
};
const nameOf = (error: unknown): string => (error as Error).constructor.name;
const attempt = (run: () => unknown): string => {
  try {
    return show(run());
  } catch (error) {
    return nameOf(error);
  }
};
// Nobody can follow a value through a property of the global object.
function taken<T>(value: unknown): T {
  (globalThis as any).handedOn = value;
  return (globalThis as any).handedOn as T;
}
class Key {
  id = 1;
}
class Held {
  id = "one";
}
function* steps() {
  try {
    yield new Key();
    yield new Held();
    yield "never asked for";
  } finally {
    console.log("the generator is closed");
  }
}
class Turned extends Array<unknown> {
  *[Symbol.iterator](): ArrayIterator<unknown> {
    for (let index = this.length; index--; ) yield this[index];
  }
}
const pair = (): [Key, Held] => [new Key(), new Held()];
function overSet(): unknown {
  let text = "";
  for (const [key, held] of taken<[Key, Held][]>([pair(), new Set([new Held(), new Key()]), pair()])) text += show(key.id) + show(held.id) + " ";
  return text;
}
function overText(): unknown {
  let text = "";
  for (const [key, held] of taken<[Key, Held][]>([pair(), "ab", pair()])) text += show(key.id) + show(held.id) + " ";
  return text;
}
function overGenerator(): unknown {
  let text = "";
  for (const [key, held] of taken<[Key, Held][]>([pair(), steps(), pair()])) text += show(key.id) + show(held.id) + " ";
  return text;
}
function overTurned(): unknown {
  let text = "";
  for (const [key, held] of taken<[Key, Held][]>([pair(), Turned.from(pair()), pair()])) text += show(key.id) + show(held.id) + " ";
  return text;
}
function overShort(): unknown {
  let text = "";
  for (const [key, held] of taken<[Key, Held][]>([pair(), [new Key()], pair()])) text += show(key.id) + show(held?.id) + " ";
  return text;
}
function overHole(): unknown {
  let text = "";
  for (const [key = new Held(), held] of taken<[Key, Held][]>([pair(), [, new Key()], pair()])) text += show(key.id) + show(held.id) + " ";
  return text;
}
function overNumber(): unknown {
  let text = "";
  for (const [key, held] of taken<[Key, Held][]>([pair(), 7, pair()])) console.log((text += show(key.id) + show(held.id) + " "));
  return text;
}
function overEntries(): unknown {
  let text = "";
  for (const [name, count] of taken<Map<string, number>>(new Map<unknown, unknown>([["one", 1], [2, "two"], [new Key(), new Held()]]))) text += show(name) + show(count) + " ";
  return text;
}
for (let round = 0; round < 3; round++) console.log(attempt(overSet), attempt(overText), attempt(overGenerator), attempt(overTurned), attempt(overShort), attempt(overHole), attempt(overNumber), attempt(overEntries));
