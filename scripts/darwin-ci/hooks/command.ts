import { $ } from "bun";
import { unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentGuestRelease, guestImage } from "../lib/config";
import { guest } from "../lib/guest";
import { fail } from "../lib/shell";
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
  process.exit((await $`bash -c ${command}`.nothrow()).exitCode);
}

const image = guestImage(
  agentGuestRelease(env) ?? fail("this agent has no release tag; re-run main.ts install-agent on the host"),
);

let cleaned = false;
async function cleanup(): Promise<void> {
  if (cleaned) return;
  cleaned = true;
  await tart.destroy(vm);
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
  console.log(`--- :tart: ${vm} from ${image}`);
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
  const status = await g.run(
    `BUILDKITE_AGENT_JOB_API_SOCKET=${socket} BUILDKITE_AGENT_JOB_API_TOKEN=${env.BUILDKITE_AGENT_JOB_API_TOKEN ?? ""} /bin/bash ~/job.sh`,
    forward,
  );

  console.log("--- :outbox_tray: collect reports");
  await g.collectReports("work", checkout);
  return status;
}

async function boot(): Promise<string | undefined> {
  await tart.cloneLocked(image, vm);
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
    .map(([key, value]) => `${key}=${$.escape(String(value ?? ""))}`);
  const file = `/tmp/${vm}.env`;
  writeFileSync(file, lines.join("\n") + "\n");
  await g.push(file, "job.env");
  unlinkSync(file);
}
