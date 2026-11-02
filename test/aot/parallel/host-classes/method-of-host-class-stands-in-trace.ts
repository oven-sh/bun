// A method of a host class stands in the trace.
function framesOf(stack: string | undefined): string {
  return (stack ?? "")
    .split("\n")
    .slice(1, 5)
    .map(line => /^\s*at (\S+) \(/.exec(line)?.[1] ?? "-")
    .join(" < ");
}

function traceOf(run: () => unknown): string {
  try {
    run();
    return "did not throw";
  } catch (error) {
    const e = error as Error;
    return e.name + ": " + e.message + " | " + framesOf(e.stack);
  }
}

const capture = Error as unknown as { captureStackTrace(target: object): void };
const glob = new Bun.Glob("*.ts");
const hasher = new Bun.CryptoHasher("sha1");
const decoder = new TextDecoder();

function matchNumber() {
  const answer = glob.match(1 as unknown as string);
  return [answer];
}
function digestUnknown() {
  const answer = hasher.digest("nothing" as unknown as "hex");
  return [answer];
}
function decodeNumber() {
  const answer = decoder.decode(5 as unknown as Uint8Array);
  return [answer];
}
console.log(traceOf(matchNumber));
console.log(traceOf(digestUnknown));
console.log(traceOf(decodeNumber));

function capturedUnderTheMethod() {
  const holder: { stack?: string } = {};
  const options = {
    get stream() {
      capture.captureStackTrace(holder);
      return false;
    },
  };
  decoder.decode(new Uint8Array([65]), options);
  return framesOf(holder.stack);
}
console.log(capturedUnderTheMethod());

function thrownUnderTheMethod() {
  const options = {
    get stream(): boolean {
      throw new RangeError("from the getter");
    },
  };
  const answer = decoder.decode(new Uint8Array([65]), options);
  return [answer];
}
console.log(traceOf(thrownUnderTheMethod));

function caughtInTheCaller() {
  let caught = "nothing";
  try {
    decoder.decode(new Uint8Array([65]), {
      get stream(): boolean {
        throw new RangeError("caught beside the call");
      },
    });
  } catch (error) {
    caught = (error as Error).message;
  } finally {
    caught += ", and the cleanup ran";
  }
  return caught;
}
console.log(caughtInTheCaller());
