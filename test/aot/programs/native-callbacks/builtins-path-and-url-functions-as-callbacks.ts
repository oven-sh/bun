// Built-ins applied by native code: functions of node:path, node:url and node:querystring validate their parameters, and as callbacks of map, reduce and replace they get numbers and arrays where they want strings.
import { basename, extname, join, normalize, resolve } from "node:path/posix";
import { escape, parse } from "node:querystring";
import { fileURLToPath } from "node:url";

function attempt(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    return (error as NodeJS.ErrnoException).code ?? (error as Error).name;
  }
}

const results = [
  attempt(() => ["/a/b.txt"].map(extname)),
  attempt(() => ["/a/b.txt"].map(normalize)),
  attempt(() => ["/a/b.txt"].map(basename as any)),
  attempt(() => ["a", "b"].map(join as any)),
  attempt(() => ["a", "b", "c"].reduce(join as any)),
  attempt(() => ["/a", "b"].reduce((all, one) => resolve(all, one))),
  attempt(() => "a b".replace(" ", escape)),
  attempt(() => ["a=1&b=2"].map(parse as any).map((one: any) => Object.keys(one).length)),
  attempt(() => ["file:///a/b"].map(fileURLToPath as any)),
  attempt(() => Reflect.apply(join, null, { length: 2, 0: "x", 1: "y" } as any)),
  attempt(() => join.apply(null, ["x", 5 as any])),
];
console.log(results.join(" "));
