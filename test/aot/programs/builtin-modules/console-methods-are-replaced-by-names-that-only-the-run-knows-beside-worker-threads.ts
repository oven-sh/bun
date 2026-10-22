// Every method of `console` is replaced in a loop over its names and put back: the names come from an array, from an array of 40 with names that `console` does not have, from Object.keys(console) and from a Set.
// Each is an assignment in compiled code under a key that only the run knows, so it works, and a call of the method afterwards finds what was stored.
// node:worker_threads stores into the global `console`, so with this import the compiler no longer knows that `console` is the built-in object alone.
import { isMainThread } from "node:worker_threads";

const lines: string[] = [];
const con = console as unknown as Record<string, unknown>;

function replaceAll(names: Iterable<string>, tag: string): () => void {
  const originals = new Map<string, unknown>();
  let count = 0;
  for (const name of names) {
    if (name in con && typeof con[name] !== "function") continue;
    originals.set(name, con[name]);
    con[name] = (...args: unknown[]) => {
      lines.push(tag + ":" + name + "(" + args.join(",") + ")");
    };
    count++;
  }
  lines.push(tag + " replaced " + (count >= 14 ? "at least 14" : String(count)));
  return () => {
    for (const [name, original] of originals) {
      if (original === undefined) delete con[name];
      else con[name] = original;
    }
  };
}

function callSome(): void {
  console.log(1);
  console.info(2);
  console.dir(3);
  console.count("4");
  console.countReset("5");
  console.group(6);
  console.groupEnd();
  console.table(7);
  console.time("8");
  console.timeEnd("9");
  console.timeLog("10");
}

const fourteen = ["log", "info", "debug", "dir", "dirxml", "count", "countReset", "group", "groupCollapsed", "groupEnd", "table", "time", "timeEnd", "timeLog"];
const forty = [...fourteen, "warn", "error", "trace", "assert", "clear", "profile", "profileEnd", "timeStamp"];
for (let index = forty.length; index < 40; index++) forty.push("added" + index);

let restore = replaceAll(fourteen, "array");
callSome();
restore();

restore = replaceAll(forty, "forty");
callSome();
console.warn(11);
console.assert(false, 12);
(con.added39 as (value: number) => void)(13);
restore();
lines.push("added39 is " + typeof con.added39);

restore = replaceAll(Object.keys(console), "keys");
callSome();
restore();

restore = replaceAll(new Set(fourteen), "set");
callSome();
restore();

console.log(lines.join("\n"));
console.log(isMainThread);
