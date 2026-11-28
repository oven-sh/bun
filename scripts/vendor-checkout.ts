import { rmSync } from "node:fs";
import { join } from "node:path";

/** Where an entry of test/vendor.json is checked out from, and to. */
interface VendorCheckout {
  repository: string;
  /** The full hash of a commit. */
  commit: string;
  vendorPath: string;
}

/**
 * Checks `commit` out at `vendorPath`, which may hold an earlier checkout.
 * @param git runs a git command, and throws when it fails
 */
export async function checkoutVendor(
  { repository, commit, vendorPath }: VendorCheckout,
  git: (...args: string[]) => Promise<void>,
): Promise<void> {
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error(`expected the full hash of a commit of ${repository}, got ${JSON.stringify(commit)}`);
  }
  await git("init", "--quiet", vendorPath);
  for (let attempt = 1; ; attempt++) {
    try {
      await git("-C", vendorPath, "fetch", "--depth", "1", repository, commit);
      break;
    } catch (error) {
      if (attempt === 3) throw error;
      console.warn(error);
      // A fetch that was killed at its time limit leaves this behind.
      rmSync(join(vendorPath, ".git", "shallow.lock"), { force: true });
    }
  }
  await git("-C", vendorPath, "checkout", "--force", "--detach", commit);
}
