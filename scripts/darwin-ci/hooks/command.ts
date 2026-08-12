import { unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../lib/config";
import { guest } from "../lib/guest";
import { fail, runInherit, shellQuote } from "../lib/shell";
import { tart } from "../lib/tart";

const env = process.env;
const command = env.BUILDKITE_COMMAND ?? "";
const jobId = env.BUILDKITE_JOB_ID ?? String(process.pid);
const checkout = env.BUILDKITE_BUILD_CHECKOUT_PATH ?? fail("no BUILDKITE_BUILD_CHECKOUT_PATH");
const vm = `bk-${jobId}`;

const hostOnlyEnv = new Set([
  "BUILDKITE_AGENT_JOB_API_SOCKET",
  "BUILDKITE_AGENT_JOB_API_TOKEN",
  "BUILDKITE_BIN_PATH",
  "BUILDKITE_BUILD_CHECKOUT_PATH",
  "BUILDKITE_BUILD_PATH",
  "BUILDKITE_ENV_FILE",
  "BUILDKITE_HOOKS_PATH",
  "BUILDKITE_PLUGINS_PATH",
  "BUILDKITE_SOCKETS_PATH",
]);

if (!command.includes("runner.node.mjs")) {
  console.log("--- running on host (not a test step)");
  // same flags buildkite-agent's own command runner uses, so a failing middle line still fails the step
  process.exit(await runInherit(["bash", "-e", "-o", "pipefail", "-c", command], { cwd: checkout }));
}

let cleaned = false;
async function cleanup(): Promise<void> {
  if (cleaned) return;
  cleaned = true;
  // pre-exit destroys it again and reaps whatever this misses, so a failure here must not override the test status
  await tart.destroy(vm).catch((error: unknown) => console.error(`failed to destroy ${vm}: ${error}`));
}
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => cleanup().finally(() => process.exit(130)));
}

let status = 1;
try {
  status = await runInGuest();
} finally {
  await cleanup();
}
process.exit(status);

async function runInGuest(): Promise<number> {
  console.log(`--- :tart: ${vm} from ${config.tart.image}`);
  const ip = (await boot()) ?? (await retryBoot()) ?? fail(`guest never came up; see /tmp/${vm}.log`);
  console.log(`    guest ${ip}`);
  const g = guest(ip);

  console.log("--- :package: sync checkout");
  await g.syncTo(checkout, "work");
  await g.push(join(import.meta.dir, "..", "guest", "job.sh"), "job.sh");
  await pushEnv(g);

  console.log(`+++ :test_tube: ${command}`);
  const socket = "/tmp/bk-job-api.sock";
  const forward = ["-o", "StreamLocalBindUnlink=yes", "-R", `${socket}:${env.BUILDKITE_AGENT_JOB_API_SOCKET}`];
  const jobEnv = [
    `BUILDKITE_AGENT_JOB_API_SOCKET=${socket}`,
    `BUILDKITE_AGENT_JOB_API_TOKEN=${shellQuote(env.BUILDKITE_AGENT_JOB_API_TOKEN ?? "")}`,
  ];
  const status = await g.run(`${jobEnv.join(" ")} /bin/bash ~/job.sh`, forward);

  console.log("--- :outbox_tray: collect reports");
  await g.collectReports("work", checkout);
  return status;
}

async function boot(): Promise<string | undefined> {
  await tart.cloneLocked(config.tart.image, vm);
  tart.start(vm, `/tmp/${vm}.log`);
  return tart.waitForSsh(vm);
}

// the first boot after a host restart can lose a race with vmnet coming up
async function retryBoot(): Promise<string | undefined> {
  console.log("    first boot failed; retrying once");
  await tart.destroy(vm);
  return boot();
}

async function pushEnv(g: ReturnType<typeof guest>): Promise<void> {
  const lines = Object.entries(env)
    .filter(([key]) => /^(BUILDKITE|BUN_|EXPECTED_PLATFORM_)|^(CI|ASAN_OPTIONS)$/.test(key) && !hostOnlyEnv.has(key))
    .map(([key, value]) => `${key}=${shellQuote(value ?? "")}`);
  const file = `/tmp/${vm}.env`;
  writeFileSync(file, lines.join("\n") + "\n", { mode: 0o600 });
  try {
    await g.push(file, "job.env");
  } finally {
    unlinkSync(file);
  }
}
