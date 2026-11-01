// The types MapIterator, SetIterator, ArrayIterator, StringIterator and RegExpStringIterator name classes of the engine, each with a cell type of its own.
// A parameter of such a type is tested for the class, and `next` is called directly.
// IR+ TypeTest .* testedType=MapIterator
// IR+ TypeTest .* testedType=SetIterator
// IR+ TypeTest .* testedType=ArrayIterator
// IR= 0 stepOfTable testedType=.*Generator
export function stepOfTable(steps: MapIterator<number>): unknown {
  return steps.next().value;
}
export function stepOfSet(steps: SetIterator<number>): unknown {
  return steps.next().value;
}
export function stepOfList(steps: ArrayIterator<number>): unknown {
  return steps.next().value;
}
export function stepOfText(steps: StringIterator<string>): unknown {
  return steps.next().value;
}
export function stepOfMatches(steps: RegExpStringIterator<RegExpExecArray>): unknown {
  return steps.next().value?.[0];
}
export function restOfTable(steps: MapIterator<number>): number {
  let sum = 0;
  for (const value of steps) sum += value;
  return sum;
}
export function restOfList(steps: ArrayIterator<number>): number {
  let sum = 0;
  for (const value of steps) sum += value;
  return sum;
}

const outside: any = JSON.parse('{"numbers":[5,6,7]}');
outside.table = new Map(outside.numbers.map((n: number) => ["k" + n, n]));
outside.set = new Set(outside.numbers);
const say = (name: string, run: () => unknown) => {
  let said: string;
  try {
    said = String(run());
  } catch (error) {
    said = "throws " + (error as Error).name;
  }
  console.log(name + ": " + said);
};
say("table", () => stepOfTable(outside.table.values()));
say("set", () => stepOfSet(outside.set.values()));
say("list", () => stepOfList(outside.numbers.values()));
say("text", () => stepOfText("text"[Symbol.iterator]()));
say("matches", () => stepOfMatches("a1b2".matchAll(/\d/g)));
say("rest of a table", () => restOfTable(outside.table.values()));
say("rest of a list", () => restOfList(outside.numbers.values()));
say("rest of a table that was stepped", () => {
  const steps = outside.table.values();
  return stepOfTable(steps) + " " + restOfTable(steps) + " " + restOfTable(steps);
});

const everyWay = (name: string, make: () => any) => {
  say(name + ", step of a table", () => stepOfTable(make()));
  say(name + ", step of a list", () => stepOfList(make()));
  say(name + ", rest of a table", () => restOfTable(make()));
  say(name + ", rest of a list", () => restOfList(make()));
};
everyWay("steps of a set", () => outside.set.values());
everyWay("keys of a list", () => outside.numbers.keys());
everyWay("a generator", () =>
  (function* () {
    yield 1;
    yield 2;
  })(),
);
everyWay("an object with next", () => ({
  left: 2,
  next() {
    return this.left-- > 0 ? { done: false, value: 10 } : { done: true, value: undefined };
  },
  [Symbol.iterator]() {
    return this;
  },
}));
everyWay("own next", () => Object.assign(outside.table.values(), { next: () => ({ done: true, value: "own" }) }));
everyWay("own Symbol.iterator", () => Object.assign(outside.table.values(), { [Symbol.iterator]: () => [100][Symbol.iterator]() }));
everyWay("another prototype", () => Object.setPrototypeOf(outside.table.values(), { next: () => ({ done: true, value: "other" }), [Symbol.iterator]: () => [200][Symbol.iterator]() }));
everyWay("no prototype", () => Object.setPrototypeOf(outside.table.values(), null));
everyWay("a helper", () => outside.table.values().map((n: number) => n * 2));
everyWay("undefined", () => undefined);
everyWay("a list", () => outside.numbers);
(globalThis as any).kept = [stepOfTable, stepOfSet, stepOfList, stepOfText, stepOfMatches, restOfTable, restOfList];
