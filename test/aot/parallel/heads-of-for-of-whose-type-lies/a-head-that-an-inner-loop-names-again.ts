// Two heads of one name: `Pair` is what the checker says of the outer one, `number` of the inner one. Each list holds what the other promises.
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
const attemptLater = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    return show(await run());
  } catch (error) {
    return nameOf(error);
  }
};
// Nobody can follow a value through a property of the global object.
function taken<T>(value: unknown): T {
  (globalThis as any).handedOn = value;
  return (globalThis as any).handedOn as T;
}
class Pair {
  first = 1;
  second = 2;
  sum() { return this.first + this.second; }
}
class Wider extends Pair {
  third = 3;
  sum() { return this.first + this.second + this.third; }
}
class Turned {
  second = "two";
  first = "one";
  sum() { return this.second + this.first; }
}
function use(): unknown {
  let text = "";
  for (const held of taken<Pair[]>([new Pair(), 3, new Pair()])) {
    text += show(held.first) + " ";
    for (const held of taken<number[]>([1, new Pair(), 2])) text += show(held + 1) + " ";
    text += show(held.second) + " ";
  }
  return text;
}
for (let round = 0; round < 3; round++) console.log(attempt(use));
