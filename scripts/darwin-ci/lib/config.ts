export const config = {
  installDir: "/usr/local/share/darwin-ci",
  tokenFile: process.env.DARWIN_CI_TOKEN_FILE ?? "/var/root/buildkite-agent-token",
  buildkiteAgent: { version: "3.114.0", bin: "/usr/local/bin/buildkite-agent" },
  queue: "test-darwin",
  ciUser: "ci",
  bun: { repo: "https://github.com/oven-sh/bun.git", ref: "main" },
  tart: {
    bin: "/opt/homebrew/bin/tart",
    baseRemote: "ghcr.io/cirruslabs/macos-sequoia-xcode:latest",
    image: "bun-ci-base",
    guestUser: "admin",
    guestRelease: 15,
    cpu: 8,
    memoryMb: 24576,
    spawn: 2,
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
