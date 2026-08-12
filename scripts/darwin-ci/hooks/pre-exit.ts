import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { succeeds } from "../lib/shell";
import { tart } from "../lib/tart";

let failed = false;
async function reap(name: string, action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    failed = true;
    console.error(`pre-exit: could not remove ${name}: ${error}`);
  }
}

const own = `bk-${process.env.BUILDKITE_JOB_ID ?? "none"}`;
await reap(own, () => tart.destroy(own));

// a bk-* guest with no `tart run` behind it belongs to a job that died without its cleanup running
const vms = join(homedir(), ".tart", "vms");
const tenMinutesAgo = Date.now() - 10 * 60_000;
for (const name of readdirSync(vms).filter((name: string) => name.startsWith("bk-"))) {
  const stat = statSync(join(vms, name), { throwIfNoEntry: false });
  if (!stat || stat.mtimeMs > tenMinutesAgo) continue;
  if (await succeeds(["pgrep", "-f", `tart run ${name}`])) continue;
  await reap(name, async () => {
    await tart.remove(name);
    console.log(`pre-exit: reaped orphan guest ${name}`);
  });
}
process.exit(failed ? 1 : 0);
