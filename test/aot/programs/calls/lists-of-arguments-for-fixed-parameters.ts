// f(...list), f.apply(t, list), new C(...list) and super(...list) where no callee can count its arguments, beside the neighbors in which somebody can tell:
// a callee that reads arguments or collects the rest, a list with an accessor, a hole or a prototype of its own, a list that is shorter or longer than the parameters,
// a list too long for the stack.
const log: string[] = [];

function two(a?: unknown, b?: unknown): string {
  return `two(${String(a)}, ${String(b)})`;
}
function withDefault(a: unknown, b: unknown = "default"): string {
  return `withDefault(${String(a)}, ${String(b)})`;
}
function counts(this: unknown, _a?: unknown): string {
  return `counts(${arguments.length})`;
}
function collects(first?: unknown, ...others: unknown[]): string {
  return `collects(${String(first)}; ${others.join("|")})`;
}
function usesThis(this: { name: string }, a?: unknown): string {
  return `${this.name}(${String(a)})`;
}

function forward(...list: unknown[]): string {
  return two(...list);
}
function forwardToDefault(...list: unknown[]): string {
  return withDefault(...(list as [unknown, unknown]));
}
function forwardToCounting(...list: unknown[]): string {
  return counts(...list);
}
function forwardToCollecting(...list: unknown[]): string {
  return collects(...list);
}
function applies(self: { name: string }, list: unknown[]): string {
  return usesThis.apply(self, list as [unknown]);
}
function oneOfTwo(pick: boolean, list: unknown[]): string {
  const callee = pick ? two : withDefault;
  return callee(...(list as [unknown, unknown]));
}
function oneOfTwoMayCount(pick: boolean, list: unknown[]): string {
  const callee = pick ? two : counts;
  return callee(...list);
}

class Base {
  x: unknown;
  y: unknown;
  constructor(x?: unknown, y?: unknown) {
    this.x = x;
    this.y = y;
  }
  show(): string {
    return `${this.constructor.name}(${String(this.x)}, ${String(this.y)})`;
  }
}
class Implicit extends Base {}
class Forwards extends Base {
  extra: number;
  constructor(...list: unknown[]) {
    super(...list);
    this.extra = list.length;
  }
}
class CountingBase {
  count: number;
  constructor(..._list: unknown[]) {
    this.count = arguments.length;
  }
}
class ForwardsToCounting extends CountingBase {
  constructor(...list: unknown[]) {
    super(...list);
  }
}
class ForwardsOneList extends Base {
  constructor(list: unknown[]) {
    super(...list);
  }
}
function constructs(list: unknown[]): string {
  return new Base(...list).show();
}
function outcome(run: () => string): string {
  try {
    return run();
  } catch (error) {
    return (error as Error).name;
  }
}
function filled(length: number): unknown[] {
  return new Array(length).fill(7);
}

function listWithAccessor(): unknown[] {
  const list: unknown[] = [1, 2, 3];
  Object.defineProperty(list, 2, { get() { log.push("third element read"); return 3; } });
  return list;
}
function listWithHole(): unknown[] {
  // eslint-disable-next-line no-sparse-arrays
  return [, "after the hole"];
}
class OddList extends Array<unknown> {
  *[Symbol.iterator](): ArrayIterator<unknown> {
    log.push("own iterator");
    yield "from the iterator";
  }
}

const self = { name: "self" };
const three: unknown[] = [1, 2, 3];
for (let round = 0; round < 3; round++) {
  console.log(forward(), forward(1), forward(1, 2), forward(1, 2, 3), forward(undefined, null));
  console.log(forwardToDefault(1), forwardToDefault(1, undefined), forwardToDefault(1, 2, 3));
  console.log(forwardToCounting(), forwardToCounting(1, 2, 3));
  console.log(forwardToCollecting(), forwardToCollecting(1), forwardToCollecting(1, 2, 3));
  console.log(applies(self, []), applies(self, ["a"]), applies(self, ["a", "b"]));
  console.log(oneOfTwo(true, [1]), oneOfTwo(false, [1]), oneOfTwo(round === 1, [1, 2, 3]));
  console.log(oneOfTwoMayCount(true, [1, 2, 3]), oneOfTwoMayCount(false, [1, 2, 3]));
  console.log(new Implicit().show(), new Implicit(1).show(), new Implicit(...(three as [unknown, unknown])).show());
  console.log(new Forwards().show(), new Forwards(1, 2, 3).show(), new Forwards(1, 2, 3).extra);
  console.log(new ForwardsToCounting().count, new ForwardsToCounting(1, 2, 3).count);
  console.log(constructs([]), constructs([1]), constructs([1, 2, 3]));
  console.log(two(...listWithAccessor()), two.apply(null, listWithAccessor() as [unknown, unknown]), log.splice(0).join(","));
  console.log(two(...listWithHole()), two.apply(null, listWithHole() as [unknown, unknown]), constructs(listWithHole()));
  console.log(two(...new OddList(1, 2)), two.apply(null, new OddList(1, 2) as unknown as [unknown, unknown]), log.splice(0).join(","));
  for (const length of [1000, 65535, 65536, 700000, 2 ** 21]) {
    const list = filled(length);
    console.log(
      length,
      outcome(() => two(...list)),
      outcome(() => two.apply(null, list as [unknown, unknown])),
      outcome(() => constructs(list)),
      outcome(() => new ForwardsOneList(list).show()),
    );
  }
}
