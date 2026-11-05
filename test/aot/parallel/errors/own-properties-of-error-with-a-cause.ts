// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
function show(value: unknown): string {
  if (typeof value === "object" && value !== null) return Object.prototype.toString.call(value);
  return typeof value + " " + String(value);
}
function attempt(label: string, action: () => unknown): void {
  let outcome: string;
  try {
    outcome = show(action());
  } catch (error) {
    outcome = (error as Error).name;
  }
  console.log(label + ": " + outcome);
}
function messageOf(error: Error): unknown {
  return error.message;
}
function causeOf(error: Error): unknown {
  return error.cause;
}
function setMessage(error: Error, message: string): void {
  error.message = message;
}
function setCause(error: Error, cause: unknown): void {
  error.cause = cause;
}
function describe(label: string, error: Error): void {
  attempt(label + ", message", () => messageOf(error));
  attempt(label + ", message again", () => messageOf(error));
  attempt(label + ", cause", () => causeOf(error));
  attempt(label + ", has", () =>
    [Object.hasOwn(error, "message"), Object.hasOwn(error, "cause"), "message" in error, "cause" in error].join(),
  );
  attempt(label + ", descriptor", () => JSON.stringify(Object.getOwnPropertyDescriptor(error, "message")));
  attempt(label + ", as a string", () => String(error));
  attempt(label + ", keys", () => Object.keys(error).join());
  attempt(label + ", stack", () => (typeof error.stack === "string" ? error.stack.split("\n")[0] : typeof error.stack));
}
const cases: [string, () => Error][] = [["a cause but no message", () => new Error(undefined, { cause: "why" })]];
for (const [name, make] of cases) {
  describe(name, make());
  const reassigned = make();
  attempt(name + ", set the message", () => setMessage(reassigned, "set afterwards"));
  describe(name + ", after setting the message", reassigned);
  const removed = make();
  attempt(name + ", delete the message", () => delete (removed as any).message);
  describe(name + ", after deleting the message", removed);
  const caused = make();
  attempt(name + ", set the cause", () => setCause(caused, "set afterwards"));
  describe(name + ", after setting the cause", caused);
}
export {};
