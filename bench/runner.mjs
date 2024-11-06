import process from "node:process";
import * as Mitata from "mitata";

const asJSON = !!process?.env?.BENCHMARK_RUNNER;

/** @param {Parameters<typeof Mitata["run"]>["0"]} opts */
export function run(opts = {}) {
  opts ??= {};

  if (asJSON) {
    opts.json = true;
  }

  return Mitata.run(opts);
}

export const bench = Mitata.bench

export const group = Mitata.group
