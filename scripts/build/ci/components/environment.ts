// Login environment for a linux image: lines that must be visible to both
// the bootstrap user and (on CI images) the buildkite user, plus every
// non-login shell. One helper so no component re-derives the profile list.

import { join } from "node:path";
import { ensureLines } from "../bootstrap/runtime.ts";
import type { LinuxContext } from "./component.ts";

/**
 * Append environment lines to the login profiles of the bootstrap user and
 * (on CI images) the buildkite user, and to /etc/profile.d for non-login
 * shells and other users. Idempotent (ensureLines skips duplicates).
 */
export async function appendToProfiles(ctx: LinuxContext, lines: string[]): Promise<void> {
  const homes = new Set<string>([ctx.host.home]);
  if (ctx.ci) homes.add(ctx.image.paths.buildkiteHome);
  for (const home of homes) {
    for (const profile of [".profile", ".bashrc", ".zshrc"]) {
      await ensureLines(join(home, profile), lines);
    }
  }
  await ensureLines("/etc/profile.d/bun-ci.sh", lines);
}
