// Records that hold themselves are given to JSON.stringify from a loop, a function called twice, a callback and an async function. Each prints the error and how often toJSON ran.
let calls = 0;
const counter = {
  toJSON() {
    calls++;
    return calls;
  },
};

const loose: { counter: unknown; self: unknown } = { counter, self: null };
loose.self = loose;

interface Holder {
  counter: unknown;
  self: Holder | null;
}
const typed: Holder = { counter, self: null };
typed.self = typed;

interface Outer {
  counter: unknown;
  middle: { counter: unknown; inner: { counter: unknown; back: unknown } };
}
const nested: Outer = { counter, middle: { counter, inner: { counter, back: null } } };
nested.middle.inner.back = nested.middle;

function report(name: string, write: () => unknown): void {
  calls = 0;
  try {
    console.log(name, write(), calls);
  } catch (error) {
    console.log(name, String(error), calls);
  }
}

for (const value of [loose]) report("loop, unknown", () => JSON.stringify(value));
for (const value of [typed]) report("loop, typed", () => JSON.stringify(value));
for (const value of [nested]) report("loop, three levels", () => JSON.stringify(value));

function writeLoose(value: { counter: unknown; self: unknown }): string {
  return JSON.stringify(value);
}
function writeTyped(value: Holder): string {
  return JSON.stringify(value);
}
function writeNested(value: Outer): string {
  return JSON.stringify(value);
}
for (let turn = 0; turn < 2; turn++) {
  report("function, unknown", () => writeLoose(loose));
  report("function, typed", () => writeTyped(typed));
  report("function, three levels", () => writeNested(nested));
}

[loose].forEach(value => report("callback, unknown", () => JSON.stringify(value)));
[typed].forEach(value => report("callback, typed", () => JSON.stringify(value)));

async function writeLater(value: Holder): Promise<string> {
  await null;
  return JSON.stringify(value);
}
calls = 0;
await writeLater(typed).then(
  text => console.log("async", text, calls),
  error => console.log("async", String(error), calls),
);

// The same records without the way back are written whole.
loose.self = null;
typed.self = { counter, self: null };
nested.middle.inner.back = [counter, counter];
report("open, unknown", () => writeLoose(loose));
report("open, typed", () => writeTyped(typed));
report("open, three levels", () => writeNested(nested));
