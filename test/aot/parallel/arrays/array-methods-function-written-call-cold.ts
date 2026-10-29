// In a very large program nearly every function is cold. The loop of an array method runs once for each element all the same, so with a function that is written at the call
// it is compiled as a loop of the caller. What the method does beside the loop stays: holes, what the callback does to the array, `this`, the three arguments, what is thrown, and the trace.
// Flags: --aot-limit=MaxWarmCodeValues:1 --aot-verify-each-pass
type Site = { getFunctionName(): string | null; isNative(): boolean };
(Error as any).prepareStackTrace = (_error: Error, sites: Site[]) =>
  sites.map(site => (site.getFunctionName() ?? "(none)") + (site.isNative() ? "[native]" : "")).join(" < ");
Error.stackTraceLimit = 4;

interface Part {
  type: string;
  size: number;
}
const parts: Part[] = [
  { type: "text", size: 1 },
  { type: "tool", size: 2 },
  { type: "text", size: 3 },
];
const withHoles: (number | undefined)[] = [1, , 3, undefined, 5];
const fractions = [0.5, 1.5, 2.5];
const whole = [1, 2, 3, 4];
const texts = ["a", "bc", "", "def"];
const nothing: number[] = [];

const scenarios: Record<string, (round: number) => unknown> = {
  forEachSum(round) {
    let sum = round;
    whole.forEach(value => {
      sum += value;
    });
    return sum;
  },
  forEachOverHoles() {
    const seen: string[] = [];
    withHoles.forEach((value, index) => {
      seen.push(index + ":" + value);
    });
    return seen.join();
  },
  forEachTakesThis() {
    const seen: unknown[] = [];
    whole.forEach(function (this: { tag: string }, value) {
      seen.push(this.tag + value);
    }, { tag: "t" });
    return seen.join();
  },
  forEachWhileTheArrayGrows() {
    const list = [1, 2, 3];
    let visits = 0;
    list.forEach(value => {
      visits++;
      if (value < 3) list.push(value + 10);
    });
    return visits + ":" + list.join();
  },
  forEachWhileTheArrayShrinks() {
    const list = [1, 2, 3, 4, 5];
    const seen: number[] = [];
    list.forEach(value => {
      seen.push(value);
      list.pop();
    });
    return seen.join() + ":" + list.join();
  },
  forEachWhileElementsAreDeleted() {
    const list = [1, 2, 3, 4];
    const seen: number[] = [];
    list.forEach((value, index) => {
      seen.push(value);
      delete list[index + 1];
    });
    return seen.join();
  },
  forEachWhileNumbersBecomeTexts() {
    const list: unknown[] = [1, 2, 3];
    const seen: unknown[] = [];
    list.forEach((value, index) => {
      seen.push(typeof value);
      list[index + 1] = "t" + index;
    });
    return seen.join() + ":" + list.length;
  },
  mapToNumbers(round) {
    return whole.map(value => value * 2 + round).join();
  },
  mapToFractions() {
    return whole.map(value => value / 2).join();
  },
  mapFractionsToWhole() {
    return fractions.map(value => Math.floor(value)).join();
  },
  mapToObjects() {
    return JSON.stringify(parts.map(part => ({ kind: part.type, twice: part.size * 2 })));
  },
  mapToTexts() {
    return parts.map(part => part.type + part.size).join();
  },
  mapKeepsHoles() {
    const mapped = withHoles.map(value => (value === undefined ? -1 : value * 2));
    return mapped.length + ":" + (1 in mapped) + ":" + mapped.join();
  },
  mapTakesIndexAndArray() {
    return texts.map((text, index, all) => text + index + all.length).join();
  },
  mapToMixedKinds(round) {
    return whole.map(value => (value % 2 ? value : value % 4 ? "two" : { round: round > 99 })).length;
  },
  filterObjects() {
    return parts.filter(part => part.type === "text").map(part => part.size).join();
  },
  filterSkipsHoles() {
    return withHoles.filter(() => true).length;
  },
  filterByTruthiness() {
    return texts.filter(text => text).join();
  },
  filterNothing() {
    return nothing.filter(value => value > 0).length;
  },
  filterLength(round) {
    return whole.filter(value => (value + round) & 1).length;
  },
  filterMapReduce(round) {
    return whole
      .filter(value => value > 1)
      .map(value => value * round)
      .reduce((sum, value) => sum + value, 0);
  },
  reduceWithoutAStart() {
    return whole.reduce((sum, value) => sum + value);
  },
  reduceOfNothing() {
    try {
      return nothing.reduce((sum, value) => sum + value);
    } catch (error) {
      return (error as Error).name + ": " + (error as Error).message;
    }
  },
  reduceToAnObject() {
    return JSON.stringify(parts.reduce<Record<string, number>>((sizes, part) => ((sizes[part.type] = (sizes[part.type] ?? 0) + part.size), sizes), {}));
  },
  reduceRight() {
    return texts.reduceRight((all, text) => all + text, "");
  },
  someAndEvery(round) {
    return [whole.some(value => value > 3 + (round & 1)), whole.every(value => value > 0), nothing.some(() => true), nothing.every(() => false)].join();
  },
  someStopsEarly() {
    let visits = 0;
    whole.some(value => (visits++, value === 2));
    return visits;
  },
  findVisitsHoles() {
    const seen: unknown[] = [];
    withHoles.find(value => (seen.push(value), false));
    return seen.length + ":" + withHoles.findIndex(value => value === undefined);
  },
  findAnObject(round) {
    return parts.find(part => part.size === (round % 4) + 1)?.type ?? "none";
  },
  findLastAndIndex() {
    return [whole.findLast(value => value < 3), whole.findLastIndex(value => value > 9), parts.findIndex(part => part.type === "tool")].join();
  },
  flatMapParts() {
    return parts.flatMap(part => (part.size > 1 ? [part.type, part.size] : [])).join();
  },
  oneInAnother() {
    let sum = 0;
    [whole, fractions].forEach(list => {
      list.forEach(value => {
        sum += value;
      });
    });
    return sum;
  },
  aMethodInACallback() {
    return [parts, []].map(list => list.filter(part => part.size > 1).length).join();
  },
  thrownInACallback() {
    try {
      whole.forEach(value => {
        if (value === 3) throw new RangeError("at " + value);
      });
      return "not thrown";
    } catch (error) {
      return (error as Error).message;
    }
  },
  traceOfForEach() {
    let trace = "";
    [1].forEach(() => {
      trace = String(new Error("x").stack);
    });
    return trace;
  },
  traceOfMap() {
    let trace = "";
    [1].map(value => ((trace = String(new Error("x").stack)), value + 1));
    return trace;
  },
  traceOfFilter() {
    let trace = "";
    [1].filter(() => ((trace = String(new Error("x").stack)), true));
    return trace;
  },
  traceOfReduce() {
    let trace = "";
    [1, 2].reduce((sum, value) => ((trace = String(new Error("x").stack)), sum + value));
    return trace;
  },
  traceOfSome() {
    let trace = "";
    [1].some(() => ((trace = String(new Error("x").stack)), true));
    return trace;
  },
  traceOfFind() {
    let trace = "";
    [1].find(() => ((trace = String(new Error("x").stack)), true));
    return trace;
  },
  aFrozenList() {
    const frozen = Object.freeze([3, 4, 5]);
    return frozen.map(value => value + 1).join() + ":" + frozen.filter(value => value > 3).join();
  },
  aListOfAClassBelowArray() {
    class Stack extends Array<number> {}
    const stack = Stack.from([1, 2, 3]);
    const mapped = stack.map(value => value * 2);
    const kept = stack.filter(value => value > 1);
    return [mapped instanceof Stack, kept instanceof Stack, mapped.join(), kept.join()].join();
  },
  aCallbackThatReturnsEarly() {
    const seen: number[] = [];
    whole.forEach(value => {
      if (value & 1) return;
      seen.push(value);
    });
    return seen.join();
  },
  aCallbackThatKeepsItsOwnClosure() {
    const readers = whole.map(value => () => value * 3);
    return readers.map(read => read()).join();
  },
  aVariableWrittenByTheCallbackIsReadBehindIt(round) {
    let last = -1;
    let count = 0;
    whole.forEach(value => {
      if (value > round) {
        last = value;
        count++;
      }
    });
    return last + ":" + count;
  },
};
(globalThis as any).scenariosOfThisProgram = scenarios;

function runAll(round: number): void {
  const found: typeof scenarios = (globalThis as any).scenariosOfThisProgram;
  for (const name of Object.keys(found)) {
    const answer = found[name]!(round);
    if (round !== 1) console.log(round, name, String(answer));
  }
}
for (let round = 0; round < 4; round++) runAll(round);
