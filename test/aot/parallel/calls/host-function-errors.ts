// An error that a built-in function throws is caught by compiled code, in the calling function or further up, with the same name, message and stack as in plain Bun.
// The stack is the first nine frames of the program's own functions: compiled code reaches some built-ins without a frame of the host, which then does not count towards the limit.
const collect: (sync: boolean) => void = (globalThis as any).gc ?? (globalThis as any).Bun?.gc ?? (() => undefined);
Error.stackTraceLimit = 10;
function names(error: unknown): string {
  const frames: string[] = [];
  for (const line of ((error as Error).stack ?? "").split("\n")) {
    const frame = /^\s*at (async )?(?:(.*?) \()?[^()]*?:(\d+):(\d+)\)?$/.exec(line) ?? /^(async )?(.*?)@.*?:(\d+):(\d+)$/.exec(line);
    if (frame) frames.push((frame[1] ?? "") + (frame[2] === "module code" || frame[2] === "<anonymous>" ? "" : frame[2] ?? "") + ":" + frame[3] + ":" + frame[4]);
  }
  return frames.slice(0, 9).join(" | ");
}
const anything: any = { json: JSON, text: "x", number: 1, uri: decodeURIComponent, big: BigInt, array: Array, define: Object.defineProperty, frozen: Object.freeze({ a: 1 }) };
const throwers: Array<[string, () => number]> = [
  ["JSON.parse", () => anything.json.parse("{").length + 1],
  ["JSON.stringify", () => { const cycle: any = {}; cycle.self = cycle; return anything.json.stringify(cycle).length + 1; }],
  ["decodeURIComponent", () => anything.uri("%").length + 1],
  ["repeat", () => anything.text.repeat(-1).length + 1],
  ["toFixed", () => anything.number.toFixed(200).length + 1],
  ["BigInt", () => Number(anything.big(1.5)) + 1],
  ["Array", () => new anything.array(-1).length + 1],
  ["defineProperty", () => anything.define(anything.frozen, "b", { value: 1 }).b + 1],
  ["normalize", () => anything.text.normalize("bad").length + 1],
  ["toString", () => anything.number.toString(99).length + 1],
];
function down(depth: number, thrower: () => number): number {
  return depth ? down(depth - 1, thrower) + 1 : thrower() + 1;
}
for (const [name, thrower] of throwers) {
  for (const depth of [0, 3, 12]) {
    try {
      console.log(name + " returned " + down(depth, thrower));
    } catch (error) {
      const e = error as Error;
      console.log(name + " " + depth + ": " + e.name + " ; " + e.message + " ; " + (e instanceof Error) + " ; " + names(e));
    }
  }
}

function inTheSameFunction(text: string): string {
  try {
    return String(anything.json.parse(text));
  } catch (error) {
    return (error as Error).name;
  }
}
console.log(inTheSameFunction("1"), inTheSameFunction("{"), inTheSameFunction("[1]"), inTheSameFunction("]"));

const log: string[] = [];
function throughFinally(depth: number): number {
  try {
    return depth ? throughFinally(depth - 1) + 1 : anything.json.parse("{").length + 1;
  } finally {
    log.push("f" + depth);
  }
}
try {
  throughFinally(2);
} catch (error) {
  console.log(log.join() + " " + (error as Error).name + " " + names(error));
}

function throughCallback(): string {
  try {
    [1, 2, 3].forEach(item => {
      if (item === 2) anything.json.parse("{");
    });
    return "nothing";
  } catch (error) {
    return (error as Error).name + " " + names(error).split(" | ").filter(frame => !frame.startsWith("forEach")).join(" | ");
  }
}
console.log(throughCallback());

function reviverThrows(): string {
  try {
    return anything.json.parse("[1,2]", (_key: string, value: unknown) => (value === 2 ? anything.uri("%") : value));
  } catch (error) {
    return (error as Error).name;
  }
}
console.log(reviverThrows());

function oneAfterAnother(): string {
  const seen: string[] = [];
  for (const [, thrower] of throwers) {
    try {
      thrower();
    } catch (first) {
      try {
        anything.json.parse("{");
      } catch (second) {
        seen.push((first as Error).name[0] + (second as Error).name[0]);
      }
    }
  }
  return seen.join();
}
console.log(oneAfterAnother());

const tick = Promise.resolve();
async function later(depth: number): Promise<number> {
  if (depth) return (await later(depth - 1)) + 1;
  await tick;
  return anything.json.parse("{").length + 1;
}
async function main(): Promise<void> {
  for (const depth of [0, 2, 11]) {
    try {
      await later(depth);
    } catch (error) {
      console.log("async " + depth + ": " + (error as Error).name + " " + names(error));
    }
  }
  let count = 0;
  const kept: unknown[] = [];
  for (let i = 0; i < 20000; i++) {
    try {
      down(i % 6, throwers[i % throwers.length]![1]);
    } catch (error) {
      count++;
      if (i % 4000 === 0) kept.push(error);
    }
    if (i % 5000 === 0) collect(true);
  }
  collect(true);
  console.log("many: " + count + " " + kept.map(error => (error as Error).name + " " + names(error).split(" | ").length).join());
}
main();
