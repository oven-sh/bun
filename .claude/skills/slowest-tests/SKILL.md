---
name: slowest-tests
description: Find the top-N slowest test files in CI from a recent BuildKite run, optionally posting the results to a Slack channel as a formatted table. Use when asked to find slow CI tests, "what's making CI slow", or to post a slow-test report to Slack.
---

# Slowest CI tests

Args: `[N] [#channel]` — both optional. `N` defaults to 500. If `#channel` is omitted, just print the table and stop.

## 1. Gather the data

Run the script. With no build number it auto-picks the most recent finished build of a merged PR in which every `test-bun` job started. That build often reports `state=failed` because of flaky tests. That is fine, the timing data is still valid.

```bash
bun run ci:slowest                 # top 500 from a recent merged-PR build → TSV on stdout
bun run ci:slowest 47324 100       # specific build, top 100
bun run ci:slowest --json > /tmp/slow.json
```

The script (`scripts/ci-slowest-tests.ts`) does the heavy lifting:

- Lists the `test-bun` jobs of the build, skipping `retried: true` and jobs that never started (no `started_at`: their log is empty).
- Fetches each job's `raw_log_url` directly with `Authorization: Bearer $BUILDKITE_TOKEN`. **Do not use `bk job log` — it hangs indefinitely on some Windows/alpine jobs.**
- Caches logs to `$TMPDIR/bun-ci-logs-<build>/` so re-runs are instant.
- Parses `_bk;t=<ms> ... --- [N/TOTAL] <file>` group headers, normalising backslashes to `/` and stripping `[attempt #N]` retries.
- Aggregates each file's duration as the **max across all platforms** (a file appears once per platform; shards within a platform are disjoint).
- Drops `package.json` / non-JS entries — those are setup steps, not tests.

If the script finds no build, it exits 1 with nothing on stdout. Do not walk the PRs by hand: the script already did that, and its stderr says what to do next.

1. `failed to list the builds of ...` lines: `bk build list` failed for those PRs, and each line carries the error. Run the same command again.
2. A `note:` that names a build: no recent build ran every `test-bun` job, and that build has the most timings. Pass its number.
3. Neither: no recent merged-PR build has test timings. Stop and report the stderr.

With a build number, a `warning:` line on stderr names the platforms whose jobs never started. The table has no timings from them, so repeat that warning wherever you post the table. A build with no test timings at all gives `error: build #N has no test timings` and exit 1.

## 2. Post to Slack (only if a channel was given)

**`slack_send_message` does NOT support markdown tables** — its markdown→blocks converter rejects `| a | b |` syntax with `invalid_blocks`. Don't use Canvases either; they render tables but the MCP proxy 502s above ~10 KB and the result is clunky.

Procedure:

1. Look up the channel ID with `slack_search_channels` (the user gives a name, you need the `C…` ID).
2. Write the full N-row markdown table to `~/code/tmp/top<N>-slow-tests.md`, then upload it as a **secret gist**: `gh gist create <file> --desc "Bun CI: top N slowest test files (build #<num>)"`. (The Slack MCP has no file-upload tool; secret gist is the agreed fallback. Do **not** ask the user to attach anything manually.)
3. Post the **main** message: header (build link + gist link, "Rest in thread.") followed by the **top 20** bullets. Row format:

   ```
   • 325s `test/js/bun/cron/in-process-cron.test.ts` 🐧 x64-baseline
   • 96s  `test/js/bun/http/serve-body-leak.test.ts` 🐧 x64-asan
   ```

   - seconds: plain text, left-aligned, padded so the backticks line up
   - filepath: code-font, **full path including `test/` prefix and extension** — do not strip anything
   - platform: standard Unicode emoji only (🐧 linux, 🪟 windows, 🍎 macOS — never workspace-custom shortcodes) followed by the arch/variant **verbatim** from the job name (`x64-asan`, `aarch64`, `x64-baseline` — do not abbreviate)

4. Reply in-thread (`thread_ts` = the main message) with rows 21–N in the same bullet format, packed into chunks under 4800 chars each (~70 rows per chunk). Post chunks sequentially so they stay ordered.
