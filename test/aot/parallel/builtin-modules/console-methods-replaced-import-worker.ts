// A terminal application replaces every method of `console` in a loop over their names and puts them back later. Every assignment in compiled code works.
// node:worker_threads stores a `new Console(..)` into the global `console` of a worker, so with that import the compiler no longer knows that `console` is the built-in object alone.
// It then took none of the stores for a store to the built-in object, treated the methods as constants, and the first assignment threw "built-in objects are read-only".
import { isMainThread } from "node:worker_threads";

const TO_DEBUG = ["log", "info", "debug", "dir", "dirxml", "count", "countReset", "group", "groupCollapsed", "groupEnd", "table", "time", "timeEnd", "timeLog"] as const;
const TO_ERROR = ["warn", "error", "trace"] as const;

class Terminal {
  lines: string[] = [];

  patchConsole(): () => void {
    const con = console;
    const originals: Partial<Record<keyof Console, Console[keyof Console]>> = {};
    const toDebug = (...args: unknown[]) => {
      this.lines.push("debug " + args.join(" "));
    };
    const toError =
      (name: string) =>
      (...args: unknown[]) => {
        this.lines.push(name + " " + args.join(" "));
      };
    for (const m of TO_DEBUG) {
      originals[m] = con[m];
      con[m] = toDebug;
    }
    for (const m of TO_ERROR) {
      originals[m] = con[m];
      con[m] =
        m === "trace"
          ? (...args: unknown[]) => {
              this.lines.push("trace " + args.join(" "));
            }
          : toError(m);
    }
    originals.assert = con.assert;
    con.assert = (condition: unknown, ...args: unknown[]) => {
      if (!condition) this.lines.push("assert " + args.join(" "));
    };
    return () => Object.assign(con, originals);
  }
}

const terminal = new Terminal();
const restore = terminal.patchConsole();
console.log("a");
console.countReset("b");
console.timeLog("c");
console.warn("d");
console.trace("e");
console.assert(false, "f");
restore();
console.log(terminal.lines.join(" | "));
console.log(isMainThread);
