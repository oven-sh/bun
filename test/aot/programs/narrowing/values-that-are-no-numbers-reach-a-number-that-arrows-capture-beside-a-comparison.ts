// What the declared type does not allow arrives all the same, through an `any`: each arrow answers as under `bun run`, the one behind the comparison and the ones beside it.
import { EventEmitter } from "node:events";
function report(limit: number, strict: boolean): string {
  return typeof limit + " " + String(limit) + " " + String(limit + 1) + " " + Object.is(limit, -0) + " " + (limit > 1) + " " + typeof strict + " " + String(strict);
}
function start({ limit = 0, strict = false }: { limit?: number; strict?: boolean } = {}): () => string {
  if (limit === 0) return () => "zero " + report(limit, strict);
  return () => "limited " + report(limit, strict);
}
function startAtFive({ limit = 5 }: { limit?: number } = {}): () => number {
  if (limit === 5) return () => limit * 2;
  if (limit === 2.5) return () => limit * 4;
  return () => limit - 1;
}
function set(target: any, path: string[], value: unknown): any {
  const key = path.shift()!;
  if (path.length > 0) target[key] = set(target[key] || {}, path, value);
  else target[key] = value;
  return target;
}
const values: unknown[] = [0, -0, 0 * 1.5, 5, 2.5, 10 / 4, 10 / 2, "0", "5", "", {}, [], [0], null, NaN, 1e300, 5n, 0n, true, false, new Number(0), new Number(5), EventEmitter.prototype, () => 1, { valueOf() { return 0; } }, undefined];
for (let round = 0; round < 3; round++) {
  for (const value of values) {
    for (const make of [start, startAtFive] as Array<(options?: any) => () => unknown>) {
      let line: string;
      try { line = String(make({ limit: value, strict: value })()); } catch (error) { line = "threw " + (error as Error).constructor.name; }
      let second: string;
      try { second = String(make(set({}, ["quota", "limit"], value).quota)()); } catch (error) { second = "threw " + (error as Error).constructor.name; }
      if (round === 2) console.log(make.name, typeof value, line, "|", second);
    }
  }
}
console.log(start(EventEmitter.prototype as any)(), "|", startAtFive(EventEmitter.prototype as any)());
