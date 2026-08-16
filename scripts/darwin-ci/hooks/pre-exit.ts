import { $ } from "bun";
import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { succeeds } from "../lib/shell";
import { tart } from "../lib/tart";

await tart.destroy(`bk-${process.env.BUILDKITE_JOB_ID ?? "none"}`);

// a bk-* guest with no `tart run` behind it belongs to a job that died without its cleanup running
const vms = join(homedir(), ".tart", "vms");
const tenMinutesAgo = Date.now() - 10 * 60_000;
for (const name of readdirSync(vms).filter((name: string) => name.startsWith("bk-"))) {
  const stat = statSync(join(vms, name), { throwIfNoEntry: false });
  if (!stat || stat.mtimeMs > tenMinutesAgo) continue;
  if (await succeeds($`pgrep -f ${`tart run ${name}`}`)) continue;
  await tart.remove(name);
  console.log(`pre-exit: reaped orphan guest ${name}`);
}
