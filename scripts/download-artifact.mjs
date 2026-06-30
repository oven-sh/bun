// Downloads a build artifact from Buildkite with retries. Lives in its own
// module (instead of inline in runner.node.mjs) so the retry policy can be
// unit-tested without booting the whole test runner.

import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

/** @typedef {(options: { command: string, args: string[], timeout: number }) => Promise<{ error?: string }>} SpawnFn */

/**
 * Download the bun build artifact for `target` into `releasePath` and return
 * the path to the downloaded `bun*.zip`.
 *
 * Retries transient failures: a slow download killed at the per-attempt
 * timeout, or the artifact not being uploaded yet (the download succeeds but
 * no zip is present). It throws only after exhausting every attempt, so a
 * single slow download no longer fails the job on the first try.
 *
 * Each attempt starts from an empty `releasePath`: a download killed at the
 * timeout can leave a truncated zip behind, and a successful retry must never
 * pick up that partial file (or a stale binary) instead of the real artifact.
 *
 * @param {object} params
 * @param {string} params.target Buildkite step name to download from.
 * @param {string} [params.buildId] Buildkite build id (defaults to the current build).
 * @param {string} params.releasePath Directory to download into.
 * @param {SpawnFn} params.spawn Spawns a command and resolves with `{ error }`.
 * @param {number} [params.attempts] Max download attempts.
 * @param {number} [params.timeout] Per-attempt timeout, in milliseconds.
 * @param {(ms: number) => Promise<void>} [params.sleep] Backoff between attempts.
 * @returns {Promise<string>}
 */
export async function downloadArtifactZip({
  target,
  buildId,
  releasePath,
  spawn,
  attempts = 10,
  timeout = 120_000,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
}) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    rmSync(releasePath, { recursive: true, force: true });
    mkdirSync(releasePath, { recursive: true });

    const args = ["artifact", "download", "**", releasePath, "--step", target];
    if (buildId) {
      args.push("--build", buildId);
    }

    const { error } = await spawn({ command: "buildkite-agent", args, timeout });
    if (error) {
      lastError = error;
      console.warn(`buildkite-agent artifact download failed for step '${target}' (${error}), retrying...`);
    } else {
      // When both are present, prefer bun-profile: it keeps its symbol table
      // (the release bun is stripped), so CI crash backtraces symbolicate.
      const zipPath = readdirSync(releasePath, { recursive: true, encoding: "utf-8" })
        .filter(filename => /^bun.*\.zip$/i.test(filename))
        .map(filename => join(releasePath, filename))
        .sort((a, b) => b.includes("profile") - a.includes("profile"))
        .at(0);

      if (zipPath) {
        return zipPath;
      }

      console.warn(`Waiting for ${target}.zip to be available...`);
    }

    if (i < attempts - 1) {
      await sleep((i + 1) * 1000);
    }
  }

  throw new Error(
    `Could not download ${target}.zip from Buildkite after ${attempts} attempts: ${releasePath}` +
      (lastError ? ` (last download error: ${lastError})` : ""),
  );
}
