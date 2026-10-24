let middleFinallyRuns = 0;

function inner(value: number): number {
  throw new RangeError("inner " + value);
}
function middle(value: number): number {
  try {
    return inner(value + 1) + 1;
  } finally {
    middleFinallyRuns++;
  }
}
function messageOf(error: unknown): string {
  return error instanceof RangeError ? error.message : "another error";
}

async function rejectsAfterResume(gate: Promise<number>, seed: number): Promise<number> {
  const offset = seed * 2 + 1;
  const resumed = await gate;
  return middle(resumed) + offset;
}
async function catchesAfterResume(gate: Promise<number>, seed: number): Promise<string> {
  const offset = seed * 2 + 1;
  const resumed = await gate;
  try {
    return "returned " + (middle(resumed) + offset);
  } catch (error) {
    return "caught " + messageOf(error) + " " + offset;
  }
}

async function awaitingCaller(seed: number): Promise<string> {
  const whole = seed * 3 + 1, fraction = seed + 0.5, text = "s" + seed, object = { value: seed * 5 + 2 }, list = [seed, seed + 2];
  let release: (value: number) => void = () => {};
  const gate = new Promise<number>(resolve => { release = resolve; });
  const rejecting = rejectsAfterResume(gate, seed);
  const catching = catchesAfterResume(gate, seed);
  release(seed * 7);
  let outcome = "";
  try {
    outcome = "resolved " + (await rejecting);
  } catch (error) {
    outcome = "rejected " + messageOf(error);
  }
  return [outcome, await catching, whole, fraction, text, object.value, list.join("+")].join(" | ");
}

function* throwsThroughCall(seed: number) {
  yield seed;
  yield middle(seed);
  yield seed + 1;
}
function* catchesInBody(seed: number) {
  yield seed;
  try {
    yield middle(seed);
  } catch (error) {
    yield messageOf(error);
  }
  yield seed + 1;
}

function stepGenerators(): void {
  const throwing = throwsThroughCall(10);
  console.log(throwing.next());
  try {
    console.log(throwing.next());
  } catch (error) {
    console.log("generator threw", messageOf(error));
  }
  console.log(throwing.next());

  const catching = catchesInBody(20);
  for (let step = catching.next(); !step.done; step = catching.next())
    console.log(step.value);
  console.log(catching.next());
}

async function main(): Promise<void> {
  console.log(await awaitingCaller(4));
  console.log("finally runs", middleFinallyRuns);
  stepGenerators();
  console.log("finally runs", middleFinallyRuns);
}
main();
