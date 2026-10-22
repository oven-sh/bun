// Bun's declarations derive DOMException from Error, and `instanceof Error` agrees, but the engine does not create one as an Error object. It enters every location of the type Error.
class Failure {
  cause: Error;
  constructor(cause: Error) {
    this.cause = cause;
  }
}
function describe(error: Error): string {
  return error.name + ": " + error.message;
}
function createAbortError(): Error {
  return new DOMException("stopped", "AbortError");
}
function throwAbortError(): void {
  throw createAbortError();
}
function describeThrown(run: () => void): string {
  try {
    run();
    return "nothing thrown";
  } catch (error) {
    return describe(error as Error);
  }
}

const variable: Error = new DOMException("in a variable", "DataError");
const list: Error[] = [
  new DOMException("in a list", "SyntaxError"),
  new RangeError("a native error"),
  new Error("an error"),
];
const byName = new Map<string, Error>([["timeout", new DOMException("in a map", "TimeoutError")]]);

console.log("a parameter:", describe(new DOMException("stopped", "AbortError")));
console.log("a result:", createAbortError().name);
console.log("a field:", describe(new Failure(createAbortError()).cause));
console.log("a variable:", describe(variable));
for (const error of list) console.log("an element:", describe(error), error instanceof Error);
console.log("a map value:", describe(byName.get("timeout")!));
console.log("thrown by a signal:", describeThrown(() => AbortSignal.abort().throwIfAborted()));
console.log("thrown by a clone:", describeThrown(() => structuredClone(describe)));
console.log("thrown by the program:", describeThrown(throwAbortError));
