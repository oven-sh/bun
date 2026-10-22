// A chain of 20,000 async functions, each awaiting the next, resumes innermost first once a timer settles the last one, without a stack overflow: with an empty microtask queue, with other jobs queued, through a thenable, and on rejection.
const chainLength = 20_000;
const settled = Promise.resolve();
type Ending = "a number" | "a thenable" | "an error";
type Chain = (depth: number, ending: Ending) => Promise<number>;

let resumed: number[] = [];
let marks: string[] = [];
let ticks = 0;
let hasOtherJobs = false;
let isChainDone = false;

function tick(): void {
  ticks++;
  if (!isChainDone) settled.then(tick);
}
function afterTimer(): Promise<void> {
  return new Promise<void>(resolve => {
    setTimeout(() => {
      if (hasOtherJobs) settled.then(tick);
      resolve();
    }, 0);
  });
}
function thenable(value: number): PromiseLike<number> {
  return {
    then(resolve: any): any {
      resolve(value);
    },
  };
}
function didResume(depth: number): void {
  resumed.push(depth);
  if (depth % 5_000 === 0 || depth === chainLength - 1) marks.push(depth + " at tick " + ticks);
}

async function innermost(ending: Ending): Promise<number> {
  await afterTimer();
  if (ending === "an error") throw new RangeError("thrown by the innermost function");
  return ending === "a thenable" ? thenable(0) : 0;
}
async function awaitsCall(depth: number, ending: Ending): Promise<number> {
  await settled;
  try {
    return 1 + (depth ? await awaitsCall(depth - 1, ending) : await innermost(ending));
  } finally {
    didResume(depth);
  }
}
async function awaitsVariable(depth: number, ending: Ending): Promise<number> {
  await settled;
  const pending = depth ? awaitsVariable(depth - 1, ending) : innermost(ending);
  try {
    return 1 + (await pending);
  } finally {
    didResume(depth);
  }
}

async function run(chain: Chain, ending: Ending, withOtherJobs: boolean): Promise<void> {
  resumed = [];
  marks = [];
  ticks = 0;
  hasOtherJobs = withOtherJobs;
  isChainDone = false;
  let outcome: string;
  try {
    outcome = "fulfilled with " + (await chain(chainLength - 1, ending));
  } catch (error) {
    outcome = "rejected with " + (error as Error).message;
  }
  isChainDone = true;
  const isInnermostFirst = resumed.length === chainLength && resumed.every((depth, index) => depth === index);
  console.log(chain.name + ", " + ending + (withOtherJobs ? ", other jobs queued: " : ", empty queue: ") + outcome + ", innermost first: " + isInnermostFirst + (withOtherJobs ? ", " + marks.join(", ") : ""));
}

for (const chain of [awaitsCall, awaitsVariable]) {
  for (const ending of ["a number", "a thenable", "an error"] as const) {
    await run(chain, ending, false);
    await run(chain, ending, true);
  }
}
