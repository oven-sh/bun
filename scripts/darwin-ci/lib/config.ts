export const config = {
  installDir: "/usr/local/share/darwin-ci",
  tokenFile: process.env.DARWIN_CI_TOKEN_FILE ?? "/var/root/buildkite-agent-token",
  buildkiteAgent: { version: "3.114.0", bin: "/usr/local/bin/buildkite-agent" },
  queue: "test-darwin",
  ciUser: "ci",
  bun: { repo: "https://github.com/oven-sh/bun.git", ref: "main" },
  tart: {
    bin: "/opt/homebrew/bin/tart",
    // One guest image per `release-tier` that .buildkite/ci.mjs schedules a darwin
    // aarch64 lane on (`latest` and `previous`; every build runs the same test step
    // once per tier). A host bakes every image and runs `spawn` agents per image,
    // so by default each host serves both lanes. `--release N` bakes and serves just one (with `--spawn 2`
    // to keep the host full), for a host whose macOS is older than the newest
    // guest (a guest cannot be newer than its host) or that lacks the disk for
    // two images.
    guests: [
      { release: 26, base: "ghcr.io/cirruslabs/macos-tahoe-xcode:latest" },
      { release: 15, base: "ghcr.io/cirruslabs/macos-sequoia-xcode:latest" },
    ],
    guestUser: "admin",
    cpu: 8,
    memoryMb: 24576,
    spawn: 1,
    // Virtualization.framework runs at most two macOS guests per host; images x spawn must fit.
    maxGuests: 2,
  },
} as const;

export const toolchain = ["bun", "node", "cmake", "ninja", "ccache", "cargo", "go", "clang-21"];

// Keep in step with darwinReleaseTier in scripts/agent.mjs.
export function releaseTier(release: number): "beta" | "latest" | "previous" | "oldest" {
  if (release > 26) return "beta";
  if (release >= 26) return "latest";
  if (release >= 14) return "previous";
  return "oldest";
}

export function guestImage(release: number): string {
  return `bun-ci-${release}`;
}

export function guestBase(release: number): string | undefined {
  return config.tart.guests.find(guest => guest.release === release)?.base;
}

/**
 * The guest release the agent running a hook serves. Agents are installed one
 * per release and tagged `release=N` (lib/agent.ts); buildkite-agent exposes
 * each tag to hooks as BUILDKITE_AGENT_META_DATA_<TAG>.
 */
export function agentGuestRelease(env: Record<string, string | undefined>): number | undefined {
  const release = env.BUILDKITE_AGENT_META_DATA_RELEASE;
  return release !== undefined && /^\d+$/.test(release) ? Number(release) : undefined;
}
