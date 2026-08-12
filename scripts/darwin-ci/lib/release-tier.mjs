// `release-tier` agent tag thresholds, shared by scripts/agent.mjs (bare hosts) and darwin-ci (tart hosts); bump LATEST once the first runner on a new macOS is online
export const LATEST_DARWIN_RELEASE = 26;
export const PREVIOUS_DARWIN_RELEASE = 14;

/** @param {number} major */
export function darwinReleaseTier(major) {
  if (major >= LATEST_DARWIN_RELEASE) return "latest";
  if (major >= PREVIOUS_DARWIN_RELEASE) return "previous";
  return "oldest";
}
