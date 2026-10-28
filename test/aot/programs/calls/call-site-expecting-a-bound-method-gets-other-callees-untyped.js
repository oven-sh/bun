const lines = [];
function attempt(run) {
  try {
    return String(run());
  } catch (error) {
    return error.constructor.name;
  }
}

class Kept {
  base;
  constructor(base) {
    this.base = base;
    this.add = this.add.bind(this);
  }
  add(n) {
    return (this === undefined ? -5000 : this.base) + n;
  }
}
function asAValue(kept, n) {
  const add = kept.add;
  return add(n);
}
function asAMember(kept, n) {
  return kept.add(n);
}
function takenApart(kept, n) {
  const { add } = kept;
  return add(n);
}
function withMoreArguments(kept, n) {
  return kept.add(n, 1, 2, 3, 4, 5, 6, 7);
}
function withNoArgument(kept) {
  return kept.add();
}
function withAText(kept) {
  return kept.add("x");
}
function inALoop(kept, n) {
  let sum = 0;
  for (let i = 0;i < 4; i++)
    sum += kept.add(n + i);
  return sum;
}
function whileTheFieldChanges(kept, n) {
  const before = kept.add;
  const first = kept.add(n);
  kept.add = Math.abs;
  const second = kept.add(-n - 1);
  kept.add = before;
  return first + second + kept.add(n);
}
const calls = [
  ["as a value", asAValue],
  ["as a member", asAMember],
  ["taken apart", takenApart],
  ["with more arguments", withMoreArguments],
  ["with no argument", withNoArgument],
  ["with a text", withAText],
  ["in a loop", inALoop],
  ["while the field changes", whileTheFieldChanges]
];
const fields = [
  ["what the constructor has bound", () => {}],
  ["what another object's constructor has bound", (kept) => {
    kept.add = new Kept(700).add;
  }],
  ["the method", (kept) => {
    kept.add = Kept.prototype.add;
  }],
  ["nothing: the field is gone", (kept) => {
    delete kept.add;
  }],
  ["a built-in function", (kept) => {
    kept.add = Math.abs;
  }],
  ["a number", (kept) => {
    kept.add = 5;
  }],
  ["a text", (kept) => {
    kept.add = "text";
  }],
  ["an object", (kept) => {
    kept.add = { base: 1 };
  }],
  ["null", (kept) => {
    kept.add = null;
  }],
  ["undefined", (kept) => {
    kept.add = undefined;
  }]
];
for (const [what, put] of fields) {
  for (const [how, call] of calls) {
    const kept = new Kept(3);
    let warm = 0;
    for (let i = 0;i < 100; i++)
      warm += Number(call(kept, i & 3));
    put(kept);
    const once = attempt(() => call(kept, 1));
    let often = 0;
    let failures = 0;
    for (let i = 0;i < 3000; i++) {
      try {
        const answer = call(kept, i & 7);
        often = often + (typeof answer === "number" ? answer : String(answer).length) | 0;
      } catch {
        failures++;
      }
    }
    let onNewObjects = 0;
    for (let i = 0;i < 300; i++) {
      const made = new Kept(i);
      if (i & 1)
        put(made);
      try {
        const answer = call(made, i & 7);
        onNewObjects = onNewObjects + (typeof answer === "number" ? answer : String(answer).length) | 0;
      } catch {
        failures++;
      }
    }
    lines.push(what + ", " + how + ": " + [warm, once, often, onNewObjects, failures].join(" "));
  }
}
console.log(lines.join(`
`));
