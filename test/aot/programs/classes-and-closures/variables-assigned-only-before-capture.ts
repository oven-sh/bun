// A variable whose last assignment comes before any closure that refers to it is created can be copied into the closure. These are such variables, and the look-alikes where a closure must still see a later assignment.
const out: string[] = [];
function say(name: string, ...values: unknown[]): void {
  out.push(name + ": " + values.map(String).join(" "));
}
function hold<T>(value: T): T {
  return [value][0];
}

function defaulted(options?: { depth: number }) {
  options = options || { depth: 1 };
  return hold(() => options!.depth);
}
function chosen(flag: boolean) {
  let picked: string;
  if (flag) picked = "yes";
  else picked = "no";
  return hold(() => picked);
}
function accumulated(parts: string[]) {
  let text = "";
  for (const part of parts) text += part;
  return hold(() => text);
}
function counted(n: number) {
  let i = 0;
  while (i < n) i++;
  return hold(() => i);
}
function destructured(pair: [number, number]) {
  let a = 0, b = 0;
  [a, b] = pair;
  ({ a, b } = { a: a + 1, b: b + 1 });
  return hold(() => a * 10 + b);
}
function inATry() {
  let state = "start";
  try {
    state = "tried";
    throw new Error("x");
  } catch {
    state += " caught";
  } finally {
    state += " done";
  }
  return hold(() => state);
}
function perIteration() {
  const made: (() => number)[] = [];
  for (let i = 0; i < 3; i++) {
    let doubled = i;
    doubled *= 2;
    made.push(() => doubled);
  }
  return made.map(f => f());
}
function loopVariableStoredToInTheBody() {
  const made: (() => number)[] = [];
  for (let i = 0; i < 6; i++) {
    i++;
    made.push(() => i);
  }
  return made.map(f => f());
}

function storedToAfterwards() {
  let n = 1;
  n = 2;
  const read = hold(() => n);
  n = 3;
  return read;
}
function storedToInTheSameLoop() {
  const made: (() => number)[] = [];
  let n = 0;
  for (let i = 0; i < 3; i++) {
    n += 10;
    made.push(() => n);
  }
  return made.map(f => f());
}
function storedToInAnOuterLoop() {
  const made: (() => number)[] = [];
  let n = 0;
  for (let i = 0; i < 2; i++) {
    n += 10;
    for (let k = 0; k < 2; k++) made.push(() => n + k);
  }
  return made.map(f => f());
}
function madeInTheValueStored() {
  let f: () => unknown = () => "first";
  f = hold(() => f);
  return f() === f;
}
function madeInTheSameStatement() {
  let n = 1;
  const pair = [hold(() => n), (n = 2)] as const;
  return pair[0];
}
function storedToByAClosure() {
  let n = 1;
  n = 2;
  const write = hold(() => (n = 5));
  const read = hold(() => n);
  write();
  return read;
}
function hoistedAndCalledEarly() {
  let n = 1;
  const early = make();
  n = 2;
  function make() {
    return hold(() => n);
  }
  return [early(), make()()];
}
function hoistedAndCalledLate() {
  let n = 1;
  n = 2;
  function make() {
    return hold(() => n);
  }
  return [make()(), hold(make)()()];
}
function inAParameterDefault(n: number, read = () => n) {
  n = n + 1;
  return read;
}
function withALabel() {
  const made: (() => number)[] = [];
  let n = 0;
  outer: for (;;) {
    n++;
    for (;;) {
      made.push(() => n);
      if (n < 3) continue outer;
      break outer;
    }
  }
  return made.map(f => f());
}
function doWhile() {
  const made: (() => number)[] = [];
  let n = 0;
  do {
    made.push(() => n);
    n++;
  } while (n < 3);
  return made.map(f => f());
}
function inAFinally() {
  let n = 0;
  let read: () => number = () => -1;
  try {
    read = hold(() => n);
  } finally {
    n = 7;
  }
  return read;
}
function* resumed() {
  let n = 0;
  n = 1;
  const read = hold(() => n);
  yield read();
  yield read();
}
async function acrossAnAwait() {
  let n = 0;
  n = await Promise.resolve(4);
  const read = hold(() => n);
  await null;
  return read();
}
class Holder {
  read: () => number;
  constructor(n: number) {
    n = n * 2;
    this.read = () => n;
  }
}
function classAfterStores() {
  let base = 1;
  base += 1;
  class Local {
    value() {
      return base;
    }
  }
  return new Local().value();
}

function storedToInAParameterDefault(n: number, stored = (n = 5), read = () => n) {
  return [stored, read()];
}
function storedToInTheBodyAfterTwoDefaults(n: number, first = () => n, second = () => n + 1) {
  n += 10;
  return [first(), second()];
}
function inASwitch(which: number) {
  let n = 0;
  let read: () => number = () => -1;
  switch (which) {
    default:
      read = hold(() => n);
    case 1:
      n = 4;
  }
  return read();
}
function afterASwitch(which: number) {
  let n = 0;
  switch (which) {
    case 0:
      n = 1;
      break;
    default:
      n = 2;
  }
  return hold(() => n);
}
function loopHeadStoresToIt() {
  let n = 0;
  for (n of [1, 2, 3]);
  let key = "";
  for (key in { a: 1, b: 2 });
  return hold(() => key + n);
}
function compoundStores() {
  let a: number | undefined;
  let b = 0;
  let c: number | null = null;
  a ??= 3;
  b ||= 4;
  c ??= 5;
  b++;
  --a;
  return hold(() => [a, b, c].join());
}
function aGetterMadeEarly() {
  let n = 1;
  const holder = {
    get value() {
      return n;
    },
  };
  n = 2;
  return holder.value;
}
function aFieldInitializerOfAClassMadeEarly() {
  let n = 1;
  class Local {
    value = n;
  }
  n = 2;
  return new Local().value;
}
function hoistedAndHandedOverEarly() {
  let n = 1;
  const early = hold(read);
  n = 2;
  function read() {
    return n;
  }
  return [early(), read()];
}
function aDefaultOfAnInnerFunction() {
  let n = 1;
  n = 2;
  function inner(read = () => n) {
    return read();
  }
  return inner();
}
function storedToInANestedBlockOfTheLoop() {
  const made: (() => number)[] = [];
  let n = 0;
  for (let i = 0; i < 3; i++) {
    made.push(() => n);
    if (i > 0) {
      n = i;
    }
  }
  return made.map(f => f());
}
function declaredInTheLoopStoredToBeforeTheClosure() {
  const made: (() => string)[] = [];
  for (const word of ["a", "b"]) {
    let text = word;
    for (let i = 0; i < 2; i++) text += i;
    made.push(() => text);
  }
  return made.map(f => f());
}

say("defaulted", defaulted()(), defaulted({ depth: 4 })());
say("chosen", chosen(true)(), chosen(false)());
say("accumulated", accumulated(["a", "b", "c"])());
say("counted", counted(5)());
say("destructured", destructured([3, 4])());
say("in a try", inATry()());
say("per iteration", ...perIteration());
say("loop variable stored to in the body", ...loopVariableStoredToInTheBody());
say("stored to afterwards", storedToAfterwards()());
say("stored to in the same loop", ...storedToInTheSameLoop());
say("stored to in an outer loop", ...storedToInAnOuterLoop());
say("made in the value stored", madeInTheValueStored());
say("made in the same statement", madeInTheSameStatement()());
say("stored to by a closure", storedToByAClosure()());
say("hoisted and called early", ...hoistedAndCalledEarly());
say("hoisted and called late", ...hoistedAndCalledLate());
say("in a parameter default", inAParameterDefault(1)());
say("with a label", ...withALabel());
say("do while", ...doWhile());
say("in a finally", inAFinally()());
say("resumed", ...resumed());
say("across an await", await acrossAnAwait());
say("constructor parameter", new Holder(4).read());
say("class after stores", classAfterStores());
say("stored to in a parameter default", ...storedToInAParameterDefault(1));
say("stored to in the body after two defaults", ...storedToInTheBodyAfterTwoDefaults(1));
say("in a switch", inASwitch(0), inASwitch(1));
say("after a switch", afterASwitch(0)(), afterASwitch(1)());
say("a loop head stores to it", loopHeadStoresToIt()());
say("compound stores", compoundStores()());
say("a getter made early", aGetterMadeEarly());
say("a field initializer of a class made early", aFieldInitializerOfAClassMadeEarly());
say("hoisted and handed over early", ...hoistedAndHandedOverEarly());
say("a default of an inner function", aDefaultOfAnInnerFunction());
say("stored to in a nested block of the loop", ...storedToInANestedBlockOfTheLoop());
say("declared in the loop, stored to before the closure", ...declaredInTheLoopStoredToBeforeTheClosure());
console.log(out.join("\n"));
