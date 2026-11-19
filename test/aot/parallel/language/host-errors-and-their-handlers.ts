// An error that native code of the host throws keeps its message, its code and the frames of its stack whoever takes it: a catch clause, a catch clause behind a finally, the promise of an async function, a handler of the process, nobody.
// The frames of the program's own functions: compiled code calls sleepSync without a frame of the host, so a stack trace has no line for it.
function frameNames(error: unknown): string {
  const names: string[] = [];
  for (const line of String((error as Error).stack).split("\n")) {
    const frame = /^\s+at (?:async )?(?:(.*?) \()?/.exec(line);
    if (frame && frame[1] && frame[1] !== "sleepSync") names.push(frame[1]);
  }
  const end = names.indexOf("outermost") + 1;
  return names.slice(0, end || names.length).join(" < ");
}
function describe(error: unknown): string {
  const { name, message, code } = error as Error & { code?: string };
  return `${name} ${code} "${message}" [${frameNames(error)}]`;
}

function throwsInHost(): void {
  Bun.sleepSync(-1);
}
function below(depth: number): number {
  if (depth > 0) return below(depth - 1) + 1;
  throwsInHost();
  return 0;
}

function caughtAtOnce(): string {
  try {
    Bun.sleepSync(-1);
    return "returned";
  } catch (error) {
    return describe(error);
  }
}
function caughtThreeFramesUp(): string {
  try {
    return String(below(2));
  } catch (error) {
    return describe(error);
  }
}
function caughtWithoutBinding(): string {
  try {
    below(1);
    return "returned";
  } catch {
    return "caught";
  }
}
const order: string[] = [];
function passesFinally(): void {
  try {
    below(0);
  } finally {
    order.push("finally");
  }
}
function caughtBehindFinally(): string {
  try {
    passesFinally();
    return "returned";
  } catch (error) {
    order.push("catch");
    return describe(error) + " " + order.join(", ");
  }
}
function rethrows(): void {
  try {
    below(0);
  } catch (error) {
    throw error;
  }
}
function caughtAfterRethrow(): string {
  try {
    rethrows();
    return "returned";
  } catch (error) {
    return describe(error);
  }
}
async function rejects(): Promise<number> {
  return below(1);
}
async function rejectsLater(): Promise<number> {
  await undefined;
  return below(1);
}
function throwsInCallbackOfHost(): string {
  try {
    [1].forEach(() => below(0));
    return "returned";
  } catch (error) {
    return describe(error);
  }
}

async function outermost(): Promise<void> {
  console.log("at once:", caughtAtOnce());
  console.log("three frames up:", caughtThreeFramesUp());
  console.log("no binding:", caughtWithoutBinding());
  console.log("behind finally:", caughtBehindFinally());
  console.log("after rethrow:", caughtAfterRethrow());
  console.log("under a callback:", throwsInCallbackOfHost());
  console.log("rejection:", await rejects().catch(describe));
  console.log("later rejection:", await rejectsLater().catch(describe));
  try {
    await rejects();
  } catch (error) {
    console.log("awaited rejection:", describe(error));
  }
}
await outermost();

process.on("uncaughtException", error => {
  console.log("nobody's:", describe(error));
});
setTimeout(function outermost() {
  below(1);
}, 0);
