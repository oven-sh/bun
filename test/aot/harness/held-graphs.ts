import { expect } from "bun:test";
import { bunEnv } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runtimeEnvironment } from "./flags";

/** An executable that runs in it writes into the folder what its run time has counted. */
export const countingIn = (dir: string) => ({ ...bunEnv, [runtimeEnvironment.countsPath]: join(dir, "counts-%p") });

/** How often the processes that ran in the folder have counted the event. */
export const counted = (dir: string, counter: string) =>
  readdirSync(dir)
    .filter(name => name.startsWith("counts-"))
    .flatMap(name => readFileSync(join(dir, name), "utf8").split("\n"))
    .filter(line => line.endsWith(`\tcounter:${counter}`))
    .reduce((sum, line) => sum + Number(line.split("\t")[0]), 0);

/** The graph of an import() that is held behind an earlier call and never let go is an import() that never settles. */
export function expectHeldGraphsLetGo(dir: string) {
  expect(counted(dir, "GraphsLetGoBehindEarlierCalls")).toBe(counted(dir, "GraphsHeldBehindEarlierCalls"));
}
