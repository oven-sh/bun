// The first step of every bake: this machine must match the image entry.
//
// One implementation for both platforms (it was three). A mismatch means
// bootstrap was pointed at the wrong entry or launched on the wrong base
// image; baking anyway would install the wrong packages. In --dry-run the
// mismatch is expected (the plan is reviewed from another OS) so it is
// reported and planning continues.

import type { Host } from "../bootstrap/host.ts";
import type { Step } from "../bootstrap/runtime.ts";
import { log, mode, warn } from "../bootstrap/runtime.ts";
import type { Image } from "../types.ts";

export function verifyHost(image: Image, host: Host): Step {
  return {
    name: "Verify host matches the spec image entry",
    run: () => {
      const problems: string[] = [];
      if (host.os !== image.os) problems.push(`os: host=${host.os} spec=${image.os}`);
      if (host.arch !== image.arch) problems.push(`arch: host=${host.arch} spec=${image.arch}`);
      if (image.os === "linux") {
        if (host.distro !== image.distro) problems.push(`distro: host=${host.distro} spec=${image.distro}`);
        if (host.abi !== undefined && host.abi !== image.abi) problems.push(`abi: host=${host.abi} spec=${image.abi}`);
        if (host.packageManager !== image.packages.manager) {
          problems.push(`package manager: host=${host.packageManager} spec=${image.packages.manager}`);
        }
      }
      if (problems.length) {
        const message =
          `This machine does not match image "${image.key}":\n  - ${problems.join("\n  - ")}\n` +
          `Refusing to bake: bootstrap was pointed at the wrong image entry or launched on the wrong base image.`;
        if (!mode.dryRun) throw new Error(message);
        warn(`${message}\n(dry-run: continuing to print the plan anyway)`);
        return;
      }
      log(`Host matches spec image "${image.key}".`);
    },
  };
}
