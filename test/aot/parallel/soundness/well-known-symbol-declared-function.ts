// A constant of type unknown holds a well-known symbol. A cast or a type guard declares it as a function, and it goes where honest functions go too.
type Step = (n: number) => number;
const held: unknown = Symbol.iterator;
const other: unknown = Symbol.asyncIterator;
function isStep(value: unknown): value is Step {
  return true;
}
function attempt(run: () => unknown): void {
  try {
    console.log(run());
  } catch (error) {
    console.log((error as Error).name);
  }
}

function call(step: Step) {
  return step(1);
}
attempt(() => call(n => n + 1));
attempt(() => call(held as Step));

function callGuarded(step: Step) {
  return step(2);
}
attempt(() => callGuarded(n => n + 2));
attempt(() => (isStep(other) ? callGuarded(other) : "not a step"));

function callBuiltIn(step: Step) {
  return step(-3);
}
attempt(() => callBuiltIn(Math.abs));
attempt(() => callBuiltIn(held as Step));

function construct(make: new () => object) {
  return typeof new make();
}
attempt(() => construct(class {}));
attempt(() => construct(held as new () => object));

function mapWith(step: Step) {
  return [1, 2].map(step).join();
}
attempt(() => mapWith(n => n + 4));
attempt(() => mapWith(held as Step));

function callThroughCall(step: Step) {
  return step.call(null, 5);
}
attempt(() => callThroughCall(n => n + 5));
attempt(() => callThroughCall(held as Step));

function compare(step: Step) {
  return typeof step + " " + (step === held);
}
attempt(() => compare(n => n + 6));
attempt(() => compare(held as Step));

let current: Step = n => n + 7;
function callCurrent() {
  return current(7);
}
attempt(callCurrent);
current = held as Step;
attempt(callCurrent);
