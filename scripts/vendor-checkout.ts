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
  await git("-C", vendorPath, "fetch", "--depth", "1", repository, commit);
  await git("-C", vendorPath, "checkout", "--force", "--detach", commit);
}
