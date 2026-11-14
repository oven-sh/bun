// A suspended sync generator with a number, a pending promise and a function in its frame is not an async frame: stack traces of the async functions awaiting the promise never include it, and its own stack traces never include them.
const settled = Promise.resolve();
Error.stackTraceLimit = 12;
function names(error: unknown): string {
  const frames: string[] = [];
  for (const line of ((error as Error).stack ?? "").split("\n")) {
    const frame = /^\s*at (async )?(?:(.*?) \()?([^()]*?):(\d+):(\d+)\)?$/.exec(line) ?? /^(async )?(.*?)@(.*?):(\d+):(\d+)$/.exec(line);
    if (frame) frames.push((frame[1] ?? "") + (frame[2] === "module code" || frame[2] === "<anonymous>" ? "" : frame[2] ?? "") + ":" + (frame[3] === "native" ? frame[3] : frame[4] + ":" + frame[5]));
  }
  return frames.join(" | ");
}

type Errors = Generator<Error, Promise<number>, void>;
const labels: ((count: number) => string)[] = [count => "even " + count, count => "odd " + count];
const promises: Promise<number>[] = [];
const resolvers: ((value: number) => void)[] = [];

function* createErrors(): Errors {
  let count = promises.length;
  const pending = new Promise<number>(resolve => void resolvers.push(resolve));
  const label = labels[count % labels.length];
  promises.push(pending);
  const end = count + 3;
  while (count < end) yield new Error(label(count++));
  return pending;
}

async function throwsOnceResolved(pending: Promise<number>): Promise<never> {
  throw new Error("resolved with " + (await pending));
}
async function middle(pending: Promise<number>): Promise<number> {
  return await throwsOnceResolved(pending);
}
async function outer(pending: Promise<number>): Promise<Error> {
  try {
    await middle(pending);
  } catch (error) {
    return error as Error;
  }
  return new Error("not reached");
}

function resumeOnce(errors: Errors): Error[] {
  return [errors.next().value as Error];
}
function resumeInForOf(errors: Errors): Error[] {
  const result: Error[] = [];
  for (const error of errors) result.push(error);
  return result;
}
function resumeInSpread(errors: Errors): Error[] {
  return [...errors];
}
function resumeInArrayFrom(errors: Errors): Error[] {
  return Array.from(errors);
}
function resumeInJob(errors: Errors): Promise<Error[]> {
  return settled.then(() => resumeOnce(errors));
}
async function resumeAfterAwait(errors: Errors): Promise<Error[]> {
  await settled;
  return resumeOnce(errors);
}

for (const resume of [resumeOnce, resumeInForOf, resumeInSpread, resumeInArrayFrom, resumeInJob, resumeAfterAwait]) {
  const errors = createErrors();
  console.log(resume.name + ", before the promise is awaited: " + names(errors.next().value));
  const index = promises.length - 1;
  const caught = outer(promises[index]);
  for (const error of await resume(errors)) console.log(resume.name + ", while the promise is awaited: " + error.message + ": " + names(error));
  resolvers[index](index);
  const thrown = await caught;
  console.log(resume.name + ", thrown after the await: " + thrown.message + ": " + names(thrown));
  const last = errors.next();
  console.log(resume.name + ", resumed again: " + (last.done ? "done" : names(last.value)));
}
