// A built-in getter, setter or conversion that refuses its receiver, where no call is written: `super.name`, Reflect.get(), a conversion to text or to a number.
// The stack of its error lists the built-in function and then the code that reads, however deep that stands and whatever Error.stackTraceLimit says.
// Flags: --aot-validate
const shown = (error: unknown) =>
  String((error as Error).stack)
    .split("\n")
    .map(line => line.trim().replace(/[^ (]*[\\/]/, ""))
    .join(" | ");
function deep(depth: number, work: () => unknown): unknown {
  if (depth > 0) {
    const result = deep(depth - 1, work);
    return result === deep ? 0 : result;
  }
  return work();
}
const key: string = process.env.NO_SUCH_NAME ?? "source";

class Pattern extends RegExp {
  get source(): string {
    try {
      return super.source;
    } catch (error) {
      return shown(error);
    }
  }
  byKey(): string {
    try {
      return (super[key as "source"] as string) + "";
    } catch (error) {
      return shown(error);
    }
  }
  inArrow(): string {
    const read = () => super.flags;
    try {
      return read();
    } catch (error) {
      return shown(error);
    }
  }
  passedOn(): string {
    return super.global + "";
  }
  behindFinally(): string {
    try {
      try {
        return super.sticky + "";
      } finally {
        counted++;
      }
    } catch (error) {
      return shown(error);
    }
  }
  async afterAwait(): Promise<string> {
    await null;
    return super.unicode + "";
  }
  static get [Symbol.species]() {
    return RegExp;
  }
}
class Table extends Map<number, number> {
  get size(): number {
    return super.size;
  }
  field = (() => {
    try {
      return super.size + "";
    } catch (error) {
      return shown(error);
    }
  })();
}
function pushLast(list: number[], value: number) {
  return list.push(value);
}
function pushAndGoOn(list: number[], value: number) {
  const length = list.push(value);
  return length + 1;
}
function readLast(map: Map<number, number>) {
  return map.size;
}
const listOfTheRun = (): number[] => Object.freeze(JSON.parse(process.env.NO_SUCH_NAME ?? "[1, 2]"));
let counted = 0;
const bare = Object.create(Pattern.prototype) as Pattern;
const attempt = (work: () => unknown) => {
  try {
    return String(work());
  } catch (error) {
    return shown(error);
  }
};
async function outer() {
  return await middle();
}
async function middle() {
  return await bare.afterAwait();
}

const forms: [string, () => unknown][] = [
  ["super.name in a getter", () => bare.source],
  ["super[key]", () => bare.byKey()],
  ["super.name in an arrow", () => bare.inArrow()],
  ["caught by the caller", () => attempt(() => bare.passedOn())],
  ["behind a finally", () => bare.behindFinally()],
  ["a getter above a getter", () => attempt(() => (Object.create(Table.prototype) as Table).size)],
  ["Reflect.get", () => attempt(() => Reflect.get(RegExp.prototype, "source", {}))],
  ["Reflect.get of a key of the run", () => attempt(() => Reflect.get(RegExp.prototype, key, {}))],
  ["to text", () => attempt(() => `${Object.create(Symbol.prototype)}`)],
  ["to a number", () => attempt(() => +Object.create(Number.prototype))],
  ["added", () => attempt(() => Object.create(Date.prototype) + "")],
  ["compared", () => attempt(() => Object.create(BigInt.prototype) < 1)],
  ["a key", () => attempt(() => (({}) as Record<PropertyKey, unknown>)[Object.create(Symbol.prototype)])],
  ["joined", () => attempt(() => [Object.create(Symbol.prototype)].join())],
  ["a method of a list that refuses, called last", () => attempt(() => pushLast(Object.seal([1, 2]), 3))],
  ["a method of a list that refuses", () => attempt(() => pushAndGoOn(Object.seal([1, 2]), 3))],
  ["a method of a list of the run that refuses, called last", () => attempt(() => pushLast(listOfTheRun(), 3))],
  ["a getter read last", () => attempt(() => readLast(Object.create(Map.prototype)))],
];
for (const limit of [10, 0, 1, 2, 3, 40, Infinity]) {
  Error.stackTraceLimit = limit;
  for (const [name, work] of forms) {
    console.log(limit, name, "at the top:", work());
    console.log(limit, name, "three deep:", deep(3, work));
    console.log(limit, name, "thirty deep:", deep(30, work));
  }
}
Error.stackTraceLimit = 10;
console.log(
  "a field:",
  attempt(() => new Table().field),
);
console.log("behind an await:", await outer().catch(shown));
console.log("behind an await, deep:", await (deep(12, outer) as Promise<string>).catch(shown));
Error.prepareStackTrace = (error, sites) =>
  sites.map(site => `${site.getFunctionName()}:${site.isNative()}:${site.getLineNumber()}`).join(",");
console.log(
  "call sites:",
  deep(4, () => attempt(() => bare.passedOn())),
);
console.log(counted);
