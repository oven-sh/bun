import { join } from "node:path";
import { config, toolchain } from "./config";
import { ensureHostKey, guest } from "./guest";
import { generateBootstrap } from "./host";
import { fail, log, shellQuote, succeeds } from "./shell";
import { tart } from "./tart";

type BakeOptions = { base: string; ref: string };

export async function bake({ base, ref }: BakeOptions): Promise<void> {
  const { image, cpu, memoryMb } = config.tart;
  const staging = `${image}-new`;
  if (!(await succeeds(["git", "check-ref-format", "--allow-onelevel", ref]))) fail(`invalid ref: ${ref}`);
  const publicKey = await ensureHostKey();

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
    `mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo ${shellQuote(publicKey)} > ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`,
  );

  const g = guest(ip);
  await g.push(join(import.meta.dir, "..", "guest", "bake.sh"), "/tmp/bake.sh");
  // The guest has no bun yet, so the host generates its setup script.
  log(`generate the toolchain script (${config.bun.repo}@${ref})`);
  await g.push(await generateBootstrap(ref), "/tmp/bootstrap.sh");

  log("install the toolchain in the guest");
  const bakeArgs = [config.buildkiteAgent.version, toolchain.join(" ")].map(shellQuote);
  const status = await g.run(
    `/bin/bash -l /tmp/bake.sh ${bakeArgs.join(" ")} 2>&1 | tee /tmp/bake.log; grep -qx BAKE_OK /tmp/bake.log`,
  );
  if (status !== 0) fail(`bake failed in guest; ${image} untouched, ${staging} left running at ${ip} for inspection`);

  // the ssh session usually drops as the guest powers off, so its exit status says nothing; the guest exiting does
  await g.run("sync; sudo shutdown -h now");
  log("waiting for guest to power off");
  let timer: Timer | undefined;
  const timeout = new Promise<false>(resolve => (timer = setTimeout(() => resolve(false), 180_000)));
  // cleared, or a pending timer would keep bake alive for the rest of the 180s after the guest is off
  const poweredOff = await Promise.race([vm.exited.then(() => true), timeout]).finally(() => clearTimeout(timer));
  if (!poweredOff)
    fail(`${staging} did not power off within 180s; ${image} untouched, ${staging} left running at ${ip}`);
  await tart.stop(staging);

  await promote(staging, image);
  log(`${image} ready`);
}

// swap under the image lock so no job clones mid-rename; the previous image is kept until the new one is in place
async function promote(staging: string, image: string): Promise<void> {
  const previous = `${image}-previous`;
  await tart.withImageLock(async () => {
    await tart.destroy(previous);
    const hadPrevious = await tart.exists(image);
    if (hadPrevious) await tart.rename(image, previous);
    try {
      await tart.rename(staging, image);
    } catch (error) {
      if (hadPrevious) await tart.rename(previous, image);
      throw error;
    }
    await tart.destroy(previous);
  });
}
