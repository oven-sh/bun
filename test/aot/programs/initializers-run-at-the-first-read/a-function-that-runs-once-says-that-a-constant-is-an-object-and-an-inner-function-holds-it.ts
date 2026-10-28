// Functions that run once say of a constant, by an assertion, a predicate or a type argument, that it is an object. They put it into a list, a field or a Map and read through it, and an inner function holds it and counts.
interface Holder {
  c: any;
}
class Other {
  d = 4;
}
function sure<T>(value: unknown): asserts value is T {}
function isHolder(value: unknown): value is Holder {
  return value !== 0;
}
function same<T>(value: T): T {
  return value;
}
function nameOf(error: unknown): string {
  return (error as any)?.name;
}

function aNumberInAList(): void {
  let tally = 0;
  const loose: unknown = 1;
  sure<Holder>(loose);
  const arrived = loose;
  const list: Holder[] = [arrived, arrived];
  const first = list[1].c;
  console.log(typeof first.c);
  (() => {
    tally += 7;
    void arrived;
  })();
  console.log(tally);
}
try {
  aNumberInAList();
} catch (error) {
  console.log("a number in a list", nameOf(error));
}

function aNumberWhoseReadsDoNotThrow(): void {
  let tally = 0;
  const loose: unknown = 2;
  sure<Holder>(loose);
  const arrived = loose;
  const list: Holder[] = [arrived, arrived];
  console.log(typeof list[1], typeof list[1].c, list.length);
  const add = () => {
    tally += 7;
    return arrived;
  };
  console.log(typeof add(), add() === list[0], tally);
}
try {
  aNumberWhoseReadsDoNotThrow();
} catch (error) {
  console.log("a number whose reads do not throw", nameOf(error));
}

function aStringInAList(): void {
  let tally = 0;
  const loose: unknown = "text";
  sure<Holder>(loose);
  const arrived = loose;
  const list: Holder[] = [arrived, arrived];
  console.log(typeof list[0].c);
  (() => {
    tally += 7;
    void arrived;
  })();
  console.log(tally, typeof list[1].c.c);
}
try {
  aStringInAList();
} catch (error) {
  console.log("a string in a list", nameOf(error));
}

function nullInAList(): void {
  let tally = 0;
  const loose: unknown = null;
  sure<Holder>(loose);
  const arrived = loose;
  const list: Holder[] = [arrived, arrived];
  (() => {
    tally += 7;
    void arrived;
  })();
  console.log(tally, list[0] === null);
  console.log(typeof list[1].c);
}
try {
  nullInAList();
} catch (error) {
  console.log("null in a list", nameOf(error));
}

function undefinedInAList(): void {
  let tally = 0;
  const loose: unknown = undefined;
  sure<Holder>(loose);
  const arrived = loose;
  const list: Holder[] = [arrived, arrived];
  (() => {
    tally += 7;
    void arrived;
  })();
  console.log(tally, list[0] === undefined, 0 in list);
  console.log(typeof list[1].c);
}
try {
  undefinedInAList();
} catch (error) {
  console.log("undefined in a list", nameOf(error));
}

function anotherClassInAList(): void {
  let tally = 0;
  const loose: unknown = new Other();
  sure<Holder>(loose);
  const arrived = loose;
  const list: Holder[] = [arrived, arrived];
  console.log(typeof list[1].c, JSON.stringify(list));
  (() => {
    tally += 7;
    void arrived;
  })();
  console.log(tally, typeof list[1].c.c);
}
try {
  anotherClassInAList();
} catch (error) {
  console.log("another class in a list", nameOf(error));
}

function aPredicate(): void {
  let tally = 0;
  const loose: unknown = 3;
  if (!isHolder(loose)) return;
  const arrived = loose;
  const list: Holder[] = [arrived, arrived];
  const first = list[1].c;
  (() => {
    tally += 7;
    void arrived;
  })();
  console.log(tally, typeof first);
  console.log(typeof first.c);
}
try {
  aPredicate();
} catch (error) {
  console.log("a predicate", nameOf(error));
}

function aTypeArgumentBetween(): void {
  let tally = 0;
  const loose: unknown = 4;
  sure<Holder>(loose);
  const arrived = same<Holder>(loose);
  const list = same<Holder[]>([arrived, arrived]);
  const first = list[1].c;
  (() => {
    tally += 7;
    void arrived;
  })();
  console.log(tally, typeof first);
  console.log(typeof first.c);
}
try {
  aTypeArgumentBetween();
} catch (error) {
  console.log("a type argument between", nameOf(error));
}

function aField(): void {
  let tally = 0;
  const loose: unknown = 5;
  sure<Holder>(loose);
  const arrived = loose;
  const box: { held: Holder; again: Holder } = { held: arrived, again: arrived };
  const first = box.again.c;
  (() => {
    tally += 7;
    void arrived;
  })();
  console.log(tally, typeof first, JSON.stringify(box));
  console.log(typeof first.c);
}
try {
  aField();
} catch (error) {
  console.log("a field", nameOf(error));
}

function aMap(): void {
  let tally = 0;
  const loose: unknown = 6;
  sure<Holder>(loose);
  const arrived = loose;
  const map = new Map<string, Holder>([
    ["first", arrived],
    ["second", arrived],
  ]);
  const first = map.get("second")!.c;
  (() => {
    tally += 7;
    void arrived;
  })();
  console.log(tally, typeof first, map.size);
  console.log(typeof first.c);
}
try {
  aMap();
} catch (error) {
  console.log("a map", nameOf(error));
}

function aGeneratorHoldsIt(): void {
  let tally = 0;
  const loose: unknown = 7;
  sure<Holder>(loose);
  const arrived = loose;
  const list: Holder[] = [arrived, arrived];
  function* steps(): Generator<Holder> {
    tally += 7;
    yield arrived;
    tally += 7;
    yield list[1];
  }
  for (const step of steps()) console.log(typeof step, typeof step.c, tally);
  console.log(typeof list[1].c.c);
}
try {
  aGeneratorHoldsIt();
} catch (error) {
  console.log("a generator holds it", nameOf(error));
}

function anAsyncFunctionHoldsIt(): Promise<void> {
  let tally = 0;
  const loose: unknown = 8;
  sure<Holder>(loose);
  const arrived = loose;
  const list: Holder[] = [arrived, arrived];
  async function later(): Promise<Holder> {
    tally += 7;
    await null;
    tally += 7;
    return arrived;
  }
  return later().then(value => {
    console.log(typeof value, typeof value.c, value === list[1], tally);
    console.log(typeof list[1].c.c);
  });
}
await anAsyncFunctionHoldsIt().catch(error => console.log("an async function holds it", nameOf(error)));

function aBooleanAndABigInt(): void {
  let tally = 0;
  const loose: unknown = true;
  const large: unknown = 10n;
  sure<Holder>(loose);
  sure<Holder>(large);
  const arrived = loose;
  const alsoArrived = large;
  const list: Holder[] = [arrived, alsoArrived];
  console.log(typeof list[0], typeof list[1], typeof list[0].c, typeof list[1].c);
  (() => {
    tally += 7;
    void arrived;
    void alsoArrived;
  })();
  console.log(tally, typeof list[1].c.c);
}
try {
  aBooleanAndABigInt();
} catch (error) {
  console.log("a boolean and a bigint", nameOf(error));
}
