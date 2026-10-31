// Flags: --aot-limit=MaxWarmCodeValues:1
// As classes.ts. Async functions: the order of what they print, try, catch and finally around an await, rejections, thenables, and several that wait at once.
const log: string[] = [];
const later = <T>(value: T, turns = 1): Promise<T> =>
  turns ? Promise.resolve().then(() => later(value, turns - 1)) : Promise.resolve(value);
async function steps(name: string, fails: boolean) {
  log.push(name + " begins");
  let total = 0;
  try {
    total += await later(1);
    log.push(name + " has " + total);
    total += await later(2, 2);
    log.push(name + " has " + total);
    if (fails) throw new RangeError(name + " fails at " + total);
    total += await { then: (resolve: (n: number) => void) => resolve(4) };
    log.push(name + " has " + total);
    return total;
  } catch (error) {
    log.push(name + " caught " + (error as Error).message);
    await later(0);
    throw new Error(name + " again", { cause: error });
  } finally {
    log.push(name + " ends with " + total);
    await later(0);
    log.push(name + " has ended");
  }
}
async function together() {
  const settled = await Promise.allSettled([steps("a", false), steps("b", true), steps("c", false)]);
  const shown = settled.map(one =>
    one.status === "fulfilled"
      ? "value " + one.value
      : "reason " + one.reason.message + " < " + one.reason.cause.message,
  );
  log.push(...shown);
  const first = await Promise.race([later("slow", 5), later("fast", 1), new Promise<string>(() => {})]);
  log.push("race: " + first);
  const any = await Promise.any([Promise.reject(new Error("no")), later("yes", 2)]);
  log.push("any: " + any);
  try {
    await Promise.all([later(1), Promise.reject(new TypeError("all fails")), later(3)]);
  } catch (error) {
    log.push("all: " + (error as Error).constructor.name + " " + (error as Error).message);
  }
  return log.length;
}
async function oneAfterAnother() {
  let text = "";
  for (const part of ["x", "y", "z"]) text += await later(part, text.length);
  for await (const part of [later("p"), "q", later("r", 3)]) text += part;
  const nested = await (async () => (await (async () => await later("deep", 2))()) + "er")();
  log.push("in turn: " + text + " " + nested);
  return text.length;
}
// Each is called twice from code that runs once: a function that is called once counts as one that runs.
async function round() {
  queueMicrotask(() => log.push("a job queued first"));
  const counted = together();
  const length = oneAfterAnother();
  log.push("the caller goes on");
  console.log(await counted, await length);
  console.log(log.splice(0).join("\n"));
}
await round();
await round();
