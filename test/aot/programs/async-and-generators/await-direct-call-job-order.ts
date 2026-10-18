// `await f()` of a directly called async function takes the same number of microtask ticks as any other await, checked against then callbacks, other awaits and nested calls.
const trace: string[] = [];
const ready = Promise.resolve("ready");
function beat(label: string, beats: number): void {
  let done = 0;
  const step = (): void => {
    trace.push(label + " " + ++done);
    if (done < beats) ready.then(step);
  };
  ready.then(step);
}

async function doubled(n: number): Promise<number> {
  return n + n;
}
async function noted(n: number): Promise<void> {
  trace.push("noted " + n);
}
async function worded(n: number): Promise<string> {
  return "<" + n + ">";
}
async function boxed(n: number): Promise<{ held: number }> {
  return { held: n };
}
async function listed(n: number): Promise<number[]> {
  return [n, n * n];
}
async function paused(n: number): Promise<number> {
  trace.push("pause begins " + n);
  await ready;
  trace.push("pause ends " + n);
  return n - 1;
}
async function pausedThenNot(n: number): Promise<number> {
  const late = await paused(n);
  trace.push("late " + late);
  const early = await doubled(n);
  trace.push("early " + early);
  return late * early;
}
async function pausedWhenEven(n: number): Promise<number> {
  if (n % 2 === 0) await ready;
  return n;
}
async function second(n: number): Promise<number> {
  trace.push("second in " + n);
  const got = await pausedThenNot(n);
  trace.push("second out " + got);
  return got - 1;
}
async function third(n: number): Promise<number> {
  return 3 * (await second(n));
}
async function awaitedOperands(n: number): Promise<number> {
  return (await paused(await pausedWhenEven(n))) - (await doubled(await doubled(n)));
}

async function runner(who: string, n: number): Promise<number> {
  trace.push(who + " begins");
  let even = 0;
  for (let i = 0; i < 4; i++) {
    even += await pausedWhenEven(n + i);
    trace.push(who + " even " + even);
  }
  const far = await third(n);
  trace.push(who + " far " + far);
  const list = await listed(n);
  trace.push(who + " list " + list.join("+"));
  const box = await boxed(n);
  trace.push(who + " box " + box.held);
  trace.push(who + " word " + (await worded(n)));
  await noted(n);
  trace.push(who + " past the note");
  const twice = await doubled(n);
  trace.push(who + " twice " + twice);
  const operands = await awaitedOperands(n);
  trace.push(who + " operands " + operands);
  const rest = await paused(n);
  trace.push(who + " rest " + rest);
  return even + far + twice + operands + rest;
}

const throughAnArrow = async (n: number): Promise<number> => (await doubled(n)) + 1;

async function conduct(): Promise<void> {
  beat("short", 5);
  const left = runner("left", 4);
  ready.then(() => trace.push("a then between the runners"));
  beat("long", 45);
  const right = runner("right", 7);
  trace.push("both are under way");
  trace.push("conduct sees " + (await ready));
  trace.push("arrow " + (await throughAnArrow(6)));
  const [l, r] = [await left, await right];
  trace.push("runners " + l + " and " + r);
  beat("after", 10);
  trace.push("far again " + (await third(5)));
  trace.push("one more " + (await runner("alone", 2)));
}

const whole = conduct();
console.log("the module has run");
await whole;
console.log(trace.join("\n"));
