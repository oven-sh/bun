// An error that is created or thrown in a static block is where the block says it: the block has a frame of its own, without a name, above the code that evaluates the class.
let calls = 0;
function describe(error: unknown): string {
  const { name, message, line, column, stack } = error as any;
  const frames: string[] = [];
  for (const text of String(stack).split("\n")) {
    const frame = /^\s*at (?:(.*?) \()?[^()]*?:(\d+):(\d+)\)?$/.exec(text);
    if (frame) frames.push((frame[1] === "module code" || frame[1] === "<anonymous>" ? "" : frame[1] ?? "") + ":" + frame[2] + ":" + frame[3]);
  }
  return name + ": " + message + " at " + line + ":" + column + ", stack " + frames.slice(0, 2).join(" | ");
}
class WithBlock {
  static fromBlock: Error;
  static {
    WithBlock.fromBlock = new URIError("static block");
  }
}
function throwInStaticBlock(): void {
  class Local {
    static {
      if (calls >= 0) throw new TypeError("thrown in a static block");
    }
  }
  calls++;
}
function caught(run: () => void): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return "nothing was thrown";
}
console.log(describe(WithBlock.fromBlock));
console.log(describe(caught(throwInStaticBlock)));
