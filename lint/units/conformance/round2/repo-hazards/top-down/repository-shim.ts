// A stand-in for bun:test and harness, enough for the four tests of the prototype run as a plain script. Prints the processor time of each.
import { isDeepStrictEqual } from "node:util";
export const isASAN = process.env.SMALL === "1";
export const isDebug = process.env.SMALL === "1";
export const describe = (_: string, f: () => void) => f();
export const test = (name: string, f: () => void, _timeout?: number) => {
  const c = process.cpuUsage();
  const w = performance.now();
  let outcome = "pass";
  try {
    f();
  } catch (e) {
    outcome = `FAIL ${(e as Error).message}`;
  }
  const d = process.cpuUsage(c);
  console.log(`${outcome}  ${((d.user + d.system) / 1000).toFixed(0)} ms cpu  ${(performance.now() - w).toFixed(0)} ms wall  ${name}`);
};
export const expect = (got: unknown) => ({
  toBe: (want: unknown) => {
    if (got !== want) throw new Error(`not the same: ${String(got).length} against ${String(want).length} characters`);
  },
  toEqual: (want: unknown) => {
    if (!isDeepStrictEqual(got, want)) throw new Error(`not equal: ${JSON.stringify(got).slice(0, 900)}`);
  },
});
