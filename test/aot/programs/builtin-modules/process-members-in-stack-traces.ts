// A read of a member of `process` is a call of a small function of the compiler's own: no stack trace shows it, and what is thrown on the way has the place of the read.
const world = globalThis as any;
function version(): unknown {
  return process.version;
}
function environment(): unknown {
  const found = process.env;
  return found;
}
function throughTwo(): unknown {
  return [version(), environment()].length;
}
function told(run: () => unknown): string {
  try {
    return "no error: " + typeof run();
  } catch (error: any) {
    const lines = String(error.stack)
      .split("\n")
      .filter(line => line.includes("process-members-in-stack-traces") || !line.includes(" at "))
      .map(line => line.replace(/\(?[^ (]*process-members-in-stack-traces\.ts/, "(here").trim());
    lines[0] = error.name + (error instanceof RangeError ? ": " + error.message : "");
    return lines.join(" | ");
  }
}
for (let i = 0; i < 3000; i++) throughTwo();
console.log(told(version), "|", told(environment));

const originalVersion = Object.getOwnPropertyDescriptor(process, "version")!;
Object.defineProperty(process, "version", {
  get: function thrower() {
    throw new RangeError("out of the getter");
  },
  configurable: true,
});
console.log(told(version));
console.log(told(throughTwo));
Object.defineProperty(process, "version", originalVersion);
console.log(told(version));

const originalProcess = process;
world.process = undefined;
const withUndefined = [told(version), told(environment), told(throughTwo)];
world.process = null;
const withNull = told(environment);
delete world.process;
const withNone = [told(version), told(environment)];
world.process = originalProcess;
for (const line of [...withUndefined, withNull, ...withNone]) console.log(line);
console.log(told(throughTwo));

let depth = 0;
function deeper(): number {
  depth++;
  return (process.env === undefined ? 0 : 1) + deeper() + (process.pid > 0 ? 1 : 0);
}
for (let round = 0; round < 3; round++) {
  depth = 0;
  try {
    deeper();
  } catch (error: any) {
    console.log("the stack is full:", error.name, depth > 1000, typeof process.env, typeof process.pid);
  }
}
export {};
