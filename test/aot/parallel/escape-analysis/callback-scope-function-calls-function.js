// A function hands a callback over its own variables to a helper that runs it in a try. The callback calls a function that the outer function was given, and stores what comes back into
// those variables. The build checks itself. The output is that of plain Bun.
// Flags: --aot-validate
function fresh() {
  return {
    count: 1,
    inner: { depth: 2 },
    action: () => 3,
    total() {
      return this.count + this.inner.depth + this.action();
    },
  };
}

function attempt(label, body) {
  let line;
  try {
    line = body();
  } catch (error) {
    line = "threw " + error.name;
  }
  console.log(label + ": " + line);
}

function inALoop(label, change) {
  let held = fresh();
  let last = "nothing";
  attempt(label + ", changed in the middle of a loop", () => {
    for (let i = 0; i < 2000; i++) {
      if (i === 1000) held = change(held);
      last = held.total() + held.count;
    }
    return "finished";
  });
  console.log(last);
}

const changes = [
  ["the prototype becomes null", object => Object.setPrototypeOf(object, null)],
  ["the prototype becomes Object.prototype", object => Object.setPrototypeOf(object, Object.prototype)],
  [
    "the prototype has members named like the fields",
    object => Object.setPrototypeOf(object, { count: 100, extra: 5, total: () => -2 }),
  ],
];
for (const [label, change] of changes) inALoop(label, change);
