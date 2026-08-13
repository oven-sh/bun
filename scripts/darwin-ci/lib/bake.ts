import { $ } from "bun";
import { join } from "node:path";
import { config, guestImage, toolchain } from "./config";
import { ensureHostKey, guest } from "./guest";
import { fail, log, output } from "./shell";
import { tart } from "./tart";

type BakeOptions = { release: number; base: string; ref: string };

export async function bake({ release, base, ref }: BakeOptions): Promise<void> {
  const { cpu, memoryMb } = config.tart;
  const image = guestImage(release);
  const staging = `${image}-new`;
  const publicKey = await ensureHostKey();

  const hostMajor = Number((await output($`sw_vers -productVersion`)).split(".")[0]);
  if (hostMajor < release) {
    fail(`this host runs macOS ${hostMajor} and cannot boot a macOS ${release} guest; pass --release <= ${hostMajor}`);
  }

  log(`pull ${base}`);
  await tart.pull(base);

  await tart.destroy(staging);
  log(`clone ${base} -> ${staging} (cpu=${cpu} mem=${memoryMb}MB)`);
  await tart.clone(base, staging);
  await tart.configure(staging, cpu, memoryMb);

  log(`boot ${staging}`);
  const vm = tart.start(staging, `/tmp/bake-${staging}.log`);
  const ip = (await tart.waitForSsh(staging, 60)) ?? fail(`${staging} never came up; see /tmp/bake-${staging}.log`);
  log(`guest up at ${ip}`);

  (await tart.waitForAgent(staging)) ?? fail("tart guest agent not responding");
  await tart.exec(
    staging,
    `mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo '${publicKey}' > ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`,
  );

  const g = guest(ip);
  // the agents for this image advertise release=<release> (lib/agent.ts), and the latest lane asserts it
  const major = (await g.capture("sw_vers -productVersion")).trim().split(".")[0];
  if (major !== String(release)) {
    await tart.destroy(staging);
    fail(`${base} is macOS ${major}, not ${release}; pass the matching --base or --release`);
  }

  await g.push(join(import.meta.dir, "..", "guest", "bake.sh"), "/tmp/bake.sh");

  log(`bootstrap toolchain in guest (${config.bun.repo}@${ref})`);
  const status = await g.run(
    `/bin/bash -l /tmp/bake.sh ${config.bun.repo} ${ref} ${config.buildkiteAgent.version} '${toolchain.join(" ")}' 2>&1 | tee /tmp/bake.log; grep -qx BAKE_OK /tmp/bake.log`,
  );
  if (status !== 0) fail(`bake failed in guest; ${image} untouched, ${staging} left running at ${ip} for inspection`);

  await g.run("sync; sudo shutdown -h now").catch(() => {});
  log("waiting for guest to power off");
  await Promise.race([vm.exited, Bun.sleep(180_000)]);
  await tart.stop(staging);

  await tart.remove(image);
  await tart.rename(staging, image);
  log(`${image} ready`);
}
