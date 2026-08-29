// The rolling "canary" GitHub release is re-used for every canary upload: the
// tag never moves, so the only record of which commit its assets were built
// from is the release notes line that .buildkite/scripts/upload-release.sh
// writes after uploading ("This release of Bun corresponds to the commit: ...").
// Resolving heads/main instead is wrong whenever an upload fails or lags,
// because main keeps moving while the assets stay behind (#40880).
export function getShaFromReleaseBody(body: string | null | undefined): string | undefined {
  const match = /corresponds to the commit:\s*([0-9a-f]{40})\b/.exec(body ?? "");
  return match?.[1];
}

// Bun embeds its build commit verbatim (it is what `Bun.revision` returns),
// so the bytes of a released binary always contain the full sha it was built
// from. This is how a downloaded binary is checked against the sha that will
// be stamped into package metadata.
export function binaryIncludesSha(binary: Buffer, sha: string): boolean {
  return binary.includes(sha, 0, "utf8");
}
