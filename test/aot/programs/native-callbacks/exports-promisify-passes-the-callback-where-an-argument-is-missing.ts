// Exports of start-up modules: the function that util.promisify returns appends its own callback to whatever it was called with, so with an argument missing the callback lands in the number parameter.
import { promisify, callbackify } from "node:util";

let total = 0;

function double(n: number, done: (error: Error | null, result?: number) => void): void {
  total += typeof n === "number" ? 1 : typeof n === "function" ? 100 : 10000;
  if (typeof n === "function") return (n as any)(null, -1);
  done(null, n * 2);
}

double(1, () => {});
const doubled = promisify(double);
total += (await doubled(4)) ?? 0;
total += (await (doubled as any)()) * 1000;
total += typeof (await (doubled as any)("5")) === "number" ? 1000000 : 0;

const failing = callbackify(async (kind: number): Promise<number> => {
  if (kind === 0) throw null;
  if (kind === 1) throw "text";
  return kind;
});
function report(error: Error | null, value?: number): void {
  total += error === null ? 10000000 * (value ?? 0) : typeof error === "string" ? 100000000 : (error as NodeJS.ErrnoException).code === "ERR_FALSY_VALUE_REJECTION" ? 200000000 : 0;
}
report(null, 0);
failing(0, report);
failing(1, report);
failing(2, report);
setTimeout(() => console.log(total), 10);
