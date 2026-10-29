// Prints the frames of errors that are thrown in async functions which take their names from a variable or a property. In some an `await` is written where the function never comes: behind a value that is never
// null, under a test of a type that is known, behind `false` and behind a `return`. Others have no `await`, or one that runs.
const state = { failing: 0, calls: 0 };
function step<T>(value: T): T {
  if (++state.calls === state.failing) throw new Error("step " + state.calls);
  return value;
}
function framesOf(error: unknown): string {
  return String((error as Error).stack)
    .split("\n")
    .slice(1)
    .map(line =>
      line
        .trim()
        .replace(/\(?[^ ()]*[\/\\][\w-]+\.ts:(\d+):(\d+)\)?/, "@$1:$2")
        .replace(/^at /, ""),
    )
    .join(" < ");
}
const later = <T>(value: T): Promise<T> => Promise.resolve(value);
const awaits = async () => {
  step(1);
  const value = await later(step(2));
  return step(value);
};
const behindNumber = async () => {
  step(1);
  return step(3) ?? (await later(step(2)));
};
const behindNull = async () => {
  step(1);
  return (step(null) as number | null) ?? (await later(step(2)));
};
const behindNumberInList = async () => {
  step(1);
  return (step(7) as number | null) ?? (await Promise.all([later(step(2))])).length;
};
const never = async () => {
  step(1);
  return step(2);
};
const neverExpression = async function () {
  step(1);
  return step(2);
};
const behindFalse = async () => {
  step(1);
  if (false) await later(1);
  return step(2);
};
const behindReturn = async () => {
  step(1);
  return step(2);
  await later(1);
};
const underTypeof = async () => {
  step(1);
  if (typeof step === "string") await later(1);
  return step(2);
};
const underTypeofThatReturns = async () => {
  step(1);
  if (typeof step === "function") return step(2);
  await later(1);
  return step(3);
};
const inInner = async () => {
  step(1);
  const inner = async () => await later(1);
  return step(inner.length);
};
const forAwait = async () => {
  step(1);
  for await (const item of []) step(item);
  return step(2);
};
const forAwaitUnderTypeof = async () => {
  step(1);
  if (typeof step === "string") for await (const item of []) step(item);
  return step(2);
};
const holder = {
  arrow: async () => {
    step(1);
    return step(3) ?? (await later(step(2)));
  },
  async method() {
    step(1);
    return step(3) ?? (await later(step(2)));
  },
  expression: async function () {
    step(1);
    return step(3) ?? (await later(step(2)));
  },
  named: async function own() {
    step(1);
    return step(3) ?? (await later(step(2)));
  },
};
class Holder {
  field = async () => {
    step(1);
    return step(3) ?? (await later(step(2)));
  };
  static async method() {
    step(1);
    return step(3) ?? (await later(step(2)));
  }
}
async function declared() {
  step(1);
  return step(3) ?? (await later(step(2)));
}
const caller = async () => {
  const value = await behindNumber();
  return value;
};
const runs: Record<string, () => Promise<unknown>> = {
  awaits: () => awaits(),
  behindNumber: () => behindNumber(),
  behindNull: () => behindNull(),
  behindNumberInList: () => behindNumberInList(),
  never: () => never(),
  neverExpression: () => neverExpression(),
  behindFalse: () => behindFalse(),
  behindReturn: () => behindReturn(),
  underTypeof: () => underTypeof(),
  underTypeofThatReturns: () => underTypeofThatReturns(),
  inInner: () => inInner(),
  forAwait: () => forAwait(),
  forAwaitUnderTypeof: () => forAwaitUnderTypeof(),
  arrow: () => holder.arrow(),
  method: () => holder.method(),
  expression: () => holder.expression(),
  named: () => holder.named(),
  field: () => new Holder().field(),
  staticMethod: () => Holder.method(),
  declared: () => declared(),
  caller,
};
for (const [name, run] of Object.entries(runs)) {
  for (state.failing = 1; state.failing <= 3; state.failing++) {
    state.calls = 0;
    try {
      await run();
      console.log(name, state.failing, "returns");
    } catch (error) {
      console.log(name, state.failing, framesOf(error));
    }
  }
}
