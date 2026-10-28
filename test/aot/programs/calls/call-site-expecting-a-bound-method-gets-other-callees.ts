// One class binds one method under the method's own name, so the calls below expect the bound function. Then the field is given other values that the compiler can follow,
// and each call runs once, 3,000 times and on new objects. No value here is a closure of another function of the program: with one of those in sight a call expects nothing.
const lines: string[] = [];
function attempt(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    return (error as Error).constructor.name;
  }
}
class Kept {
  base: number;
  constructor(base: number) {
    this.base = base;
    this.add = this.add.bind(this);
  }
  add(n: number): number {
    return (this === undefined ? -5000 : this.base) + n;
  }
}
function asAValue(kept: Kept, n: number): unknown {
  const add = kept.add;
  return add(n);
}
function asAMember(kept: Kept, n: number): unknown {
  return kept.add(n);
}
function takenApart(kept: Kept, n: number): unknown {
  const { add } = kept;
  return add(n);
}
function withMoreArguments(kept: Kept, n: number): unknown {
  return (kept.add as any)(n, 1, 2, 3, 4, 5, 6, 7);
}
function withNoArgument(kept: Kept): unknown {
  return (kept.add as any)();
}
function withAText(kept: Kept): unknown {
  return (kept.add as any)("x");
}
function inALoop(kept: Kept, n: number): unknown {
  let sum = 0;
  for (let i = 0; i < 4; i++) sum += kept.add(n + i);
  return sum;
}
function whileTheFieldChanges(kept: Kept, n: number): unknown {
  const before = kept.add;
  const first = kept.add(n);
  (kept as any).add = Math.abs;
  const second = kept.add(-n - 1);
  kept.add = before;
  return first + second + kept.add(n);
}
const calls: [string, (kept: Kept, n: number) => unknown][] = [
  ["as a value", asAValue],
  ["as a member", asAMember],
  ["taken apart", takenApart],
  ["with more arguments", withMoreArguments],
  ["with no argument", withNoArgument],
  ["with a text", withAText],
  ["in a loop", inALoop],
  ["while the field changes", whileTheFieldChanges],
];
const fields: [string, (kept: Kept) => void][] = [
  ["what the constructor has bound", () => {}],
  ["what another object's constructor has bound", kept => { kept.add = new Kept(700).add; }],
  ["the method", kept => { kept.add = Kept.prototype.add; }],
  ["nothing: the field is gone", kept => { delete (kept as any).add; }],
  ["a built-in function", kept => { (kept as any).add = Math.abs; }],
  ["a number", kept => { (kept as any).add = 5; }],
  ["a text", kept => { (kept as any).add = "text"; }],
  ["an object", kept => { (kept as any).add = { base: 1 }; }],
  ["null", kept => { (kept as any).add = null; }],
  ["undefined", kept => { (kept as any).add = undefined; }],
];
for (const [what, put] of fields) {
  for (const [how, call] of calls) {
    const kept = new Kept(3);
    // The call has seen what it expects before it meets the other thing.
    let warm = 0;
    for (let i = 0; i < 100; i++) warm += Number(call(kept, i & 3));
    put(kept);
    const once = attempt(() => call(kept, 1));
    let often = 0;
    let failures = 0;
    for (let i = 0; i < 3000; i++) {
      try {
        const answer = call(kept, i & 7);
        often = (often + (typeof answer === "number" ? answer : String(answer).length)) | 0;
      } catch {
        failures++;
      }
    }
    let onNewObjects = 0;
    for (let i = 0; i < 300; i++) {
      const made = new Kept(i);
      if (i & 1) put(made);
      try {
        const answer = call(made, i & 7);
        onNewObjects = (onNewObjects + (typeof answer === "number" ? answer : String(answer).length)) | 0;
      } catch {
        failures++;
      }
    }
    lines.push(what + ", " + how + ": " + [warm, once, often, onNewObjects, failures].join(" "));
  }
}
console.log(lines.join("\n"));
