export const lines = [];
export class Box {
  constructor(held, extra) {
    this.held = held;
    this.extra = extra;
  }
}
export function show(value) {
  if (typeof value === "function") return "function>" + show(value());
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(",") + "]";
  if (value instanceof Box) return "Box(" + show(value.held) + "," + show(value.extra) + ")";
  if (value instanceof Error) return "Error(" + value.message + ")";
  if (value !== null && typeof value === "object") return "{" + Object.keys(value).map(key => key + ":" + show(value[key])).join(",") + "}";
  return Object.is(value, -0) ? "-0" : String(value);
}
export function note(label, ...values) {
  lines.push(label + ": " + values.map(show).join(" "));
}
export function mix(...values) {
  let sum = 7;
  for (const value of values) for (const unit of show(value)) sum = (sum * 31 + unit.charCodeAt(0)) | 0;
  return sum;
}
export const passers = [value => value, value => value];
export function churn(count) {
  const kept = [];
  for (let index = 0; index < count; index++) kept.push({ index, text: "c" + index, list: [index] });
  return kept.length;
}
export function descend(depth, number, text) {
  const pair = { number, text };
  return depth === 0 ? show(pair).length : descend(depth - 1, number + 1, text) + (pair.number & 1);
}
export function disturb() {
  churn(300);
}
export async function answerLater(value) {
  await null;
  return value;
}
export async function failLater(value) {
  await null;
  throw new Error("failed " + value);
}
export function* countUp(value) {
  const got = yield value;
  yield mix(got, value);
  return value + 1;
}
export const registry = new FinalizationRegistry(markCollected => markCollected());
export function readName(value) {
  return value.name.length;
}

export function act(iterator, action, step) {
  if (action === "throw") return iterator.throw(new Error("thrown in at " + step));
  if (action === "return") return iterator.return("returned at " + step);
  return iterator.next(step);
}
export function actionAt(script, step) {
  return script[Math.min(step, script.length - 1)];
}
export function driveGenerators(label, iterators, script) {
  const steps = iterators.map(() => 0);
  const isDone = iterators.map(() => false);
  for (let round = 0; round < 3000 && isDone.includes(false); round++) {
    const at = round % iterators.length;
    if (isDone[at]) continue;
    try {
      const result = act(iterators[at], actionAt(script, steps[at]), steps[at]);
      note(label + " " + at, steps[at], result.value, result.done);
      isDone[at] = result.done;
    } catch (error) {
      note(label + " " + at + " threw", steps[at], error);
      isDone[at] = true;
    }
    steps[at]++;
    disturb();
  }
}
export async function driveAsyncGenerators(label, iterators, script) {
  await Promise.all(
    iterators.map(async (iterator, at) => {
      for (let step = 0; step < 3000; step++) {
        try {
          const result = await act(iterator, actionAt(script, step), step);
          note(label + " " + at, step, result.value, result.done);
          if (result.done) return;
        } catch (error) {
          note(label + " " + at + " threw", step, error);
          return;
        }
        disturb();
      }
    }),
  );
}
export async function walkAsyncGenerator(label, iterator, last) {
  let step = 0;
  try {
    for await (const value of iterator) {
      note(label, step, value);
      if (step++ === last) break;
    }
  } catch (error) {
    note(label + " threw", step, error);
  }
}
