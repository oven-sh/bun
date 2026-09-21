/**
 * Build-time CLI of the `order_file_trace` edge (bun.ts `emitOrderFileTrace`): trace the unordered binary and write
 * the symbol ordering file the final link reads.
 *
 *   argv: [runtime, trace-order-file.ts, <unordered executable>, <order file>]
 *
 * On Buildkite a trace that fails does not fail the build: the order file is an optimization, and a flaky workload
 * must not kill a release at its last step. The edge then writes an order file that orders nothing, the final link is
 * the unordered one again, and the failure is an annotation on the build (ci.ts `reportOrderFileFailure`). Anywhere
 * else the edge fails: someone asked for an ordered binary (`--traceOrderFile=on`), and an edge that succeeded would
 * not run again, so every later build would quietly link unordered.
 */
import { writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { isBuildkite } from "../buildkite.ts";
import { generateOrderFile } from "../orderfile/generate.ts";
import { reportOrderFileFailure } from "./ci.ts";
import { EMPTY_ORDER_FILE } from "./flags.ts";
import { formatElapsed } from "./tty.ts";

const [exe, out] = process.argv.slice(2).map(arg => resolve(arg));
if (exe === undefined || out === undefined) {
  console.error("usage: trace-order-file.ts <unordered executable> <order file>");
  process.exit(2);
}

const started = performance.now();
console.log(`Tracing ${basename(exe)} to build a fresh order file`);
console.log("Each workload runs under an injected function-entry tracer, so it is slower than a normal run.\n");
try {
  const { count } = generateOrderFile({
    buildDir: dirname(exe),
    exeName: basename(exe).replace(/\.exe$/i, ""),
    outPath: out,
    verbose: true,
  });
  console.log(`\n+ symbol order: traced ${count} functions in ${formatElapsed(performance.now() - started)}`);
} catch (error) {
  if (!isBuildkite) {
    console.error(`symbol order: the trace failed: ${(error as Error).message}`);
    process.exit(1);
  }
  reportOrderFileFailure(error as Error);
  writeFileSync(out, EMPTY_ORDER_FILE);
}
