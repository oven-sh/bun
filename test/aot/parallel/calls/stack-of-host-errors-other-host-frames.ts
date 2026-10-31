// Errors that host functions create when compiled code reached them through other host code: a bound function, a bound function of a bound function, an accessor of a built-in read by name,
// Reflect.apply, Function.prototype.call, a callback of a native function. The trace lists the frames that plain Bun lists, at every limit, whether it is read at once or later.
import { lstatSync, realpathSync } from "node:fs";

// A built-in that calls back may be expanded where it is called, so only the native frames above the program's first frame are compared, and a trace through such a built-in only where the limit cuts nothing off.
function frames(error: unknown): string {
  const list: string[] = [];
  let sawProgramFrame = false;
  for (const line of String((error as Error).stack).split("\n")) {
    const frame = /^\s*at (?:new )?(.*?) \((.*)\)$/.exec(line);
    if (!frame) continue;
    const [, name, location] = frame;
    if (name.startsWith("<parse>")) continue;
    const isNative = location === "unknown" || location === "[native code]" || location.startsWith("native");
    if (!isNative) sawProgramFrame = true;
    else if (sawProgramFrame) continue;
    list.push(isNative ? name + " (native)" : location.startsWith("node:") ? name + " (library)" : name + ":" + (/:(\d+):\d+$/.exec(location)?.[1] ?? location));
    if (name === "root") break;
  }
  return list.join(" < ");
}

const boundParse = JSON.parse.bind(JSON);
const boundTwice = boundParse.bind(null);
const boundWithArgument = JSON.parse.bind(JSON, "{");
const sourceGetter = Object.getOwnPropertyDescriptor(RegExp.prototype, "source")!.get!;
const notARegExp: any = Object.create(RegExp.prototype);
const subject: any = "x";

const callsBack = new Set(["callback of replace", "callback of sort", "valueOf under a host function"]);
const throwers: Record<string, () => unknown> = {
  "bound function": () => { const result = boundParse("{"); return [result]; },
  "bound twice": () => { const result = boundTwice("{"); return [result]; },
  "bound with an argument": () => { const result = boundWithArgument(); return [result]; },
  "fs.lstatSync": () => { const result = lstatSync("/nonexistent/path"); return [result]; },
  "fs.realpathSync": () => { const result = realpathSync("/nonexistent/path"); return [result]; },
  "getter called": () => { const result = sourceGetter.call({}); return [result]; },
  "getter read by name": () => { const result = notARegExp.source; return [result]; },
  "Reflect.apply": () => { const result = Reflect.apply(JSON.parse, null, ["{"]); return [result]; },
  "Function.prototype.call": () => { const result = JSON.parse.call(null, "{"); return [result]; },
  "constructor": () => { const result = new Intl.NumberFormat("not a locale"); return [result]; },
  "BigInt": () => { const result = BigInt("x"); return [result]; },
  "callback of replace": () => { const result = subject.replace(/x/, function callback() { const inner = boundParse("{"); return String(inner); }); return [result]; },
  "callback of sort": () => { const result = [2, 1].sort(function compare() { const inner = boundTwice("{"); return Number(inner); }); return [result]; },
  "valueOf under a host function": () => { const result = Math.max({ valueOf() { const inner = boundParse("{"); return Number(inner); } } as any); return [result]; },
};

let kept: unknown[] = [];
function innermost(thrower: () => unknown): unknown { const result = thrower(); kept.push(result); return result; }
function inlinedA(thrower: () => unknown): unknown { const result = innermost(thrower); kept.push(result); return result; }
function inlinedB(thrower: () => unknown): unknown { const result = inlinedA(thrower); kept.push(result); return result; }
class Holder {
  constructor(public thrower: () => unknown) {}
  run(): unknown { const result = inlinedB(this.thrower); kept.push(result); return result; }
}
function recurse(holder: Holder, depth: number): unknown {
  const result = depth > 0 ? recurse(holder, depth - 1) : holder.run();
  kept.push(result);
  return result;
}
function root(thrower: () => unknown, depth: number): unknown {
  try {
    const result = recurse(new Holder(thrower), depth);
    kept.push(result);
    return undefined;
  } catch (error) {
    return error;
  }
}

const later: [string, unknown][] = [];
for (const limit of [0, 1, 2, 3, 4, 6, 10, 40]) {
  Error.stackTraceLimit = limit;
  for (const name in throwers) {
    if (callsBack.has(name) && limit < 40) continue;
    for (const depth of [0, 3]) {
      const error = root(throwers[name], depth);
      console.log(limit, depth, name, "|", (error as Error).constructor.name, "|", frames(error));
      later.push([limit + " " + depth + " " + name, root(throwers[name], depth)]);
    }
  }
}
Error.stackTraceLimit = 10;
Bun.gc(true);
for (const [label, error] of later) console.log("later", label, "|", frames(error));
