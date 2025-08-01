import * as Mitata from "mitata";
import process from "node:process";

const asJSON = !!process?.env?.BENCHMARK_RUNNER;

/** @param {Parameters<typeof Mitata["run"]>["0"]} opts */
export function run(opts = {}) {
  if (asJSON) {
    opts.format = "json";
  }

  return Mitata.run(opts);
}

export const bench = Mitata.bench;

export function group(_name, fn) {
  return Mitata.group(fn);
}
