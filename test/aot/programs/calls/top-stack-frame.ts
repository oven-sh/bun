// The first and the last line of a stack: errors made in small functions that get inlined, in constructors, getters and callbacks, at every limit, read the first time and again.
function names(error: unknown): string {
  const frames: string[] = [];
  for (const line of ((error as Error).stack ?? "").split("\n")) {
    const frame = /^\s*at (async )?(?:(.*?) \()?[^()]*?:(\d+):(\d+)\)?$/.exec(line) ?? /^(async )?(.*?)@.*?:(\d+):(\d+)$/.exec(line);
    if (frame) frames.push((frame[1] ?? "") + (frame[2] === "module code" || frame[2] === "<anonymous>" ? "" : (frame[2] ?? "").replace(/^new /, "")) + ":" + frame[3]);
  }
  return frames.join(" | ");
}
let calls = 0;
function tiny(): Error {
  const error = new Error("tiny");
  calls++;
  return error;
}
function callsTiny(): Error {
  const error = tiny();
  calls++;
  return error;
}
function callsTinyTwice(second: boolean): Error {
  const a = tiny();
  const b = tiny();
  calls++;
  return second ? b : a;
}
function threeLevels(): Error {
  const error = callsTiny();
  calls++;
  return error;
}
class Shape {
  error: Error;
  constructor() {
    this.error = new Error("in a constructor");
  }
  get problem(): Error {
    const error = new RangeError("in a getter");
    calls++;
    return error;
  }
  static make(): Shape {
    const shape = new Shape();
    calls++;
    return shape;
  }
  method(): Error {
    const error = tiny();
    calls++;
    return error;
  }
}
class Square extends Shape {
  side: number;
  constructor() {
    super();
    this.side = 1;
  }
}
class Failure extends Error {
  code: number;
  constructor(message: string) {
    super(message);
    this.code = 7;
  }
}
class WorseFailure extends Failure {
  constructor() {
    super("worse");
  }
}
function fails(): Failure {
  const failure = new Failure("failed");
  calls++;
  return failure;
}
function failsWorse(): Failure {
  const failure = new WorseFailure();
  calls++;
  return failure;
}
const makers: Array<[string, () => Error]> = [
  ["tiny", tiny],
  ["callsTiny", callsTiny],
  ["first of two", () => { const e = callsTinyTwice(false); calls++; return e; }],
  ["second of two", () => { const e = callsTinyTwice(true); calls++; return e; }],
  ["threeLevels", threeLevels],
  ["constructor", () => { const e = new Shape().error; calls++; return e; }],
  ["static method", () => { const e = Shape.make().error; calls++; return e; }],
  ["derived constructor", () => { const e = new Square().error; calls++; return e; }],
  ["getter", () => { const e = new Shape().problem; calls++; return e; }],
  ["method", () => { const e = new Shape().method(); calls++; return e; }],
  ["subclass of Error", fails],
  ["subclass of a subclass", failsWorse],
  ["callback", () => { const e = [1].map(() => { const inner = tiny(); calls++; return inner; })[0]!; return e; }],
];
function under(depth: number, maker: () => Error): Error {
  if (depth) {
    const error = under(depth - 1, maker);
    calls++;
    return error;
  }
  const error = maker();
  calls++;
  return error;
}
class Builder {
  built: Error;
  constructor(depth: number, maker: () => Error) {
    this.built = under(depth, maker);
  }
}
Error.stackTraceLimit = 10;
for (const [name, maker] of makers) {
  const seen = new Set<string>();
  for (let round = 0; round < 3; round++) seen.add(names(maker()).replace(/map:\d+ \| /, ""));
  console.log(name + ": " + seen.size + " " + [...seen][0]);
}
for (const limit of [1, 2, 3, 4, 5, 9, 10, 11]) {
  Error.stackTraceLimit = limit;
  const lines: string[] = [];
  for (const depth of [0, 1, 2, 3, 7, 8, 9]) {
    const plain = names(under(depth, callsTiny)).split(" | ");
    const built = names(new Builder(depth, fails).built).split(" | ");
    lines.push(depth + "=" + plain.length + "," + plain[plain.length - 1] + "," + built.length + "," + built[built.length - 1]);
  }
  console.log("limit " + limit + ": " + lines.join(" "));
}
console.log(calls);
