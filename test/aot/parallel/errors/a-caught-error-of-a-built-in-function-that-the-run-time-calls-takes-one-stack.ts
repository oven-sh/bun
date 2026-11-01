// A built-in getter or conversion that refuses its receiver, where no call is written, and a `catch` of the program that takes the error.
// The error has its stack. Nobody lists the frames of the throw, so no second stack is taken for it, and the one of the error begins at the code that reads without a walk over the frames on top.
// COUNT: sought:StacksOfThrows = 0
// COUNT: sought:RunsBelowListedFrames = 0
function deep(depth: number, work: () => unknown): unknown {
  if (depth > 0) {
    const result = deep(depth - 1, work);
    return result === deep ? 0 : result;
  }
  return work();
}
const key: string = process.env.NO_SUCH_NAME ?? "sticky";
const frames = (error: unknown) => String((error as Error).stack).split("\n").length;
class Pattern extends RegExp {
  get source(): string {
    try {
      return super.source;
    } catch (error) {
      return "caught here " + frames(error);
    }
  }
  byKey(): boolean {
    return super[key as "sticky"];
  }
  async later(): Promise<boolean> {
    await null;
    return super.global;
  }
}
const bare = Object.create(Pattern.prototype) as Pattern;
const attempt = (work: () => unknown) => {
  try {
    return work();
  } catch (error) {
    return "caught by the caller " + frames(error);
  }
};
console.log(deep(30, () => bare.source));
console.log(deep(30, () => attempt(() => bare.byKey())));
console.log(deep(30, () => attempt(() => Reflect.get(RegExp.prototype, "source", {}))));
console.log(deep(30, () => attempt(() => `${Object.create(Symbol.prototype)}`)));
console.log(deep(30, () => attempt(() => +Object.create(Number.prototype))));
console.log(await (deep(30, () => bare.later()) as Promise<boolean>).catch(error => "rejected " + frames(error)));
