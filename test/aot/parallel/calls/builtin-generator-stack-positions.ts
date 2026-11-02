// A frame of a generator nested in one of Bun's built-in functions shows what plain Bun shows: a line counted from the start of the built-in function, and no file. Its column is left out. A generator of the program shows its own line.
function fail(message: string): never {
  throw new Error(message);
}
function* ownGenerator(): Generator<number> {
  yield 1;
  fail("own generator");
}

// The frames down to attempt(), without directories and messages: the language's own errors are worded differently under --aot.
function frames(stack: string): string {
  const lines = stack.split("\n").filter(line => /^\s*at /.test(line));
  const end = lines.findIndex(line => line.includes("at attempt "));
  return lines
    .slice(0, end + 1)
    .map(line => line.trim().replace(/[^\s(]*[\\/]/, "").replace(/\(native:(\d+):\d+\)/, "(native:$1)"))
    .join(" | ");
}

// The generator that scanSync() returns delegates to an array iterator, which has no throw method, so the TypeError is created in the generator's own frame.
function throwIntoBuiltinGenerator(): void {
  const paths = new Bun.Glob("*").scanSync({ cwd: "/", onlyFiles: false });
  console.log("suspended: " + !paths.next().done);
  paths.throw!(new Error("not delivered"));
}
function resumeOwnGenerator(): void {
  const numbers = ownGenerator();
  numbers.next();
  numbers.next();
}

function attempt(label: string, run: () => void): void {
  try {
    run();
    console.log(label + ": returned");
  } catch (error) {
    console.log(label + ": " + (error as Error).constructor.name + ": " + frames((error as Error).stack!));
  }
}

attempt("built-in generator", throwIntoBuiltinGenerator);
attempt("own generator", resumeOwnGenerator);
export {};
