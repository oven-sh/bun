// The header shapes runner.node.mjs writes into a CI job log, shared by the
// per-file timing parsers (scripts/ci-slowest-tests.ts and
// scripts/update-test-durations.mjs). Plain .mjs so the durations script keeps
// running under node.
//
// Per-file cost is the gap between the APC timestamps Buildkite injects into
// consecutive `[N/M] <path>` headers (ESC `_bk;t=<ms>` BEL). The runner emits
// several header shapes that must each close the open span:
//   - serial test start: `--- [N/M] <path>` (startGroup)
//   - retry/error label: `--- [N/M] <path> - <error>` (not a path)
//   - parallel-bucket phase: `--- [A-B/M] K files in parallel`, then after the
//     single `bun test --parallel` run a summary `[N/M] <path> (X.XXs)` per file
//   - parallel-safe phase: `--- Running N parallel-safe tests`, then a bare
//     `[N/M] <path>` per concurrent dispatch (no recoverable wall clock)
//   - other startGroup phases: `--- napi prebuild: ...`, `--- End`
// A parser that only recognises the first shape folds the entire following
// phase into whichever serial test happened to precede it.
//
// pipeTestStdout sanitises `--- ` in streamed test output, but a chunk boundary
// mid-token or one of the raw-write paths (coordinator stdout, retry
// stdoutPreview) can still deliver a line that starts `--- ` without being a
// group header (unified-diff `--- a/<file>`, `--- ps ---`). The boundary check
// is therefore an allowlist of the phase headers the runner actually emits,
// not any `--- `. When runner.node.mjs grows a new phase between the serial
// tests and the next `[N/M]` header, add it here.

/**
 * @param {string} body one log line with its APC timestamp and SGR codes removed
 * @returns {boolean}
 */
export const isPhaseGroupHeader = body =>
  /^--- (?:\[\d+-\d+\/\d+\]|napi prebuild:|Running \d+ parallel-safe|End\b|Summary\b|Received \w+, exiting)/.test(body);
