# Runbook: node:quic header queue PR (scratch, not for merge)

Restore this directory in a fresh container:

    cd /workspace/bun && git fetch origin refs/notes/robobun-8c601df3-pr-body
    mkdir -p /tmp/probes && git show FETCH_HEAD:pr-body.md > /tmp/pr-body.md
    for f in $(git ls-tree -r --name-only FETCH_HEAD probes/); do git show FETCH_HEAD:$f > /tmp/$f; done
    chmod +x /tmp/probes/*.sh

BASE below is the tree without the fix: `origin/main` after #46528 merged
(`origin/claude/http-consolidated` before that). A fresh container needs
`git fetch origin main claude/http-consolidated` first.

## Status of 2026-11-02

#46528 merged main (3f3a9ff87c: the WebKit upgrade, the AOT change, the bun test rework of #44833,
the libspng removal) and its head moved from 001958b155 to edb9ce8f7a. None of the 8 files of the
cut changed in that range.

The cut on edb9ce8f7a is cbdf3fbf60 + 1689b23582 (8 files, +693/-67). Its code is that of
7749f49591 + 524abcc7e3. Three comments changed on 2026-11-02: the doc of may_hold_queued_block is
one line, the SendHeaders enum has no doc line of its own, and the comment on the empty Retry arm
of send_headers says "joins the queue below".

Run on edb9ce8f7a (debug build): quic-stream.test.ts 128 pass (3 of 3 runs at 4f0e5ee46a, and once
more at 1689b23582), and 114 pass / 14 fail (the same 14, no timeout) with the base's src/ and
packages/. test/js/node/quic/ 194 pass, serve-http3.test.ts 117 pass, fetch-http3-client.test.ts
107 pass and 1 skip. The titles of the test.each rows and describe.concurrent are as before under
the new runner.

Checks of section 1b at 1689b23582: clippy exit 0 with no warning, source lints 195 pass, prettier
and rustfmt clean, tsc of both scripts projects with 0 errors, 0 comment groups for Comment Cop.
`cargo check --workspace --all-targets` had no warning at 4f0e5ee46a (same code).

Probes and vendored files on edb9ce8f7a (19:40Z, base build and the build of 1689b23582): every
number of section 2 is as on 2026-10-30, except the curl row, which is a range on the base. The
base loses 15 of 24 in 10 of 10 runs and 81 of 100 in 6 of 6. The 235 vendored files give the same
exit code on both builds (the same 3 fail).

Main after the merge into #46528 (checked 2026-11-03T19:55Z, main 675ee5b97b): #47836 is the one
commit that touches a file of the cut. It deletes `lsquic_conn_get_server_cert_chain` and
`Conn::server_cert_chain` from src/lsquic_sys/lib.rs (lines 140 and 491 of the cut's file; the
cut's hunks are at 40 and 611, and #47836's hunk applies cleanly on top of the cut). It also
changes session.rs and tls.rs (session.peerCertificate reads SSL_get_peer_certificate()). Main
also has a BoringSSL bump (41bf9b59c2 -> 89a2ff2be7). Both are in the handshake that every QUIC
test runs through, so the rerun after the next main merge is a real check. #46528 and #46522 are
CONFLICTING with main since then.

NOT run again on edb9ce8f7a: the release builds and the gdb counts of section 3. Their numbers
below are of 2026-10-30 on 001958b155. Section 1 to 3 run in full on main after the merge.

Pitfalls:
- Never put `&` after a `cmd1 && cmd2 && ...` chain: the tool kills what still runs when the call
  returns. Run the steps in the foreground. Only a build goes to the background, as
  `(nohup bun bd --version > /tmp/build.log 2>&1; echo "BUILD_EXIT=$?" >> /tmp/build.log) > /dev/null 2>&1 &`
  and then a poll loop on BUILD_EXIT.
- Never build the release profile into build/release (it is the system bun). Use
  `--build-dir=build/release-measure`.
- A debug binary is 1.6 GB. Copies: /tmp/bun-debug-pr, /tmp/bun-debug-base. Check `df -h /`.
- In the container of 2026-10-30 a debug build took 5 min, a release build 7 min, an incremental
  one 2 min. Earlier containers needed 40 min for a debug build. On 2026-11-02 the first debug
  build after the merge of main with the WebKit upgrade took 8 min and 10 GB of disk.

## 1. Debug builds and tests

    bun bd --version                                   # PR tree
    bun bd test test/js/node/quic/quic-stream.test.ts  # 128 pass
    bun bd test test/js/node/quic/                     # 194 pass (4 files)
    bun bd test test/js/bun/http/serve-http3.test.ts   # 117 pass
    bun bd test test/js/web/fetch/fetch-http3-client.test.ts  # 107 pass, 1 skip
    cp build/debug/bun-debug /tmp/bun-debug-pr
    /tmp/probes/run-vendored.sh /tmp/bun-debug-pr /tmp/vendored-pr.txt   # 235 files, 3 fail

Red run (what the gate does):

    git checkout --no-overlay BASE -- src/ packages/ && git status --short   # 5 files staged
    bun bd test test/js/node/quic/quic-stream.test.ts  # 114 pass, 14 fail (the new cases)
    cp build/debug/bun-debug /tmp/bun-debug-base
    git checkout --no-overlay HEAD -- src/ packages/ && git status --short   # clean
    /tmp/probes/run-vendored.sh /tmp/bun-debug-base /tmp/vendored-base.txt # the same 3 fail

The 3 vendored files that fail on both: test-quic-h3-stream-idle-timeout.mjs,
test-quic-session-initial-rtt.mjs, test-quic-stream-idle-timeout.mjs.

## 1b. The GitHub Actions checks of the PR (not Buildkite)

The harness's CI wake names a Buildkite build, so do not rely on it for these jobs: look at them
yourself after the PR is open (`gh pr checks <n>`). Run the local ones on the main-based cut first.

- Rust lints / `cargo clippy` (the PR touches src/**/*.rs and scripts/build/**). After a `bun bd`
  (it needs build/debug/codegen):

      export BUN_CODEGEN_DIR=$PWD/build/debug/codegen CARGO_TARGET_DIR=$PWD/build/clippy-target
      cargo clippy --workspace --no-deps --keep-going          # exit 0, no warning, 2 min
      cargo check --workspace --all-targets --keep-going       # exit 0, no warning, 2 min
      rm -rf build/clippy-target                               # 3 to 9 GB

  `bun_runtime` shows as "Compiling bun_runtime" in the log (it has a build script), not "Checking".
- Rust lints / `cargo miri test`: its crate list (scripts/rust-miri.ts) has neither bun_runtime nor
  bun_lsquic_sys, so the diff cannot change it.
- Rust lints / `mordant`: advisory (`continue-on-error`). A lint pack with a per-crate baseline
  (mordant-baseline.toml), which has no entry for any quic file and no bun_lsquic_sys section. Not
  run locally: it needs nightly-2026-09-01 with rustc-dev and a `cargo install --git` of the tool.
  If the job names stream.rs or lsquic_sys/lib.rs on the PR, fix that finding.
- source-lints: `bun test test/internal/source-lints/` with the system bun, as the job does
  (195 pass, 30 s).
- autofix.ci (format.yml): `bunx prettier --check` on the 3 TS files of the cut, and
  `rustfmt --edition 2024 --check` on the 2 Rust files. clang-format does nothing under
  packages/bun-usockets (`DisableFormat: true` in its .clang-format), and the .c files are not in
  its file set.
- Lint JavaScript: `bun lint` covers src/js only (bunfig.toml), which the cut does not touch. It
  also runs `bunx tsc --noEmit -p scripts/build/tsconfig.json` and `-p scripts/tsconfig.json`
  (0 errors).
- Comment Cop: a PR by robobun gets the label `claude` (auto-label-claude-prs.yml), and then every
  group of 2 or more consecutive ADDED comment lines in a file under src/ gets a review comment
  that asks to delete it (`SAFETY:` groups excepted). Keep every added comment under src/ to one
  line. packages/, scripts/ and test/ are not scanned. `python3 /tmp/probes/comment-cop-scan.py
  origin/main` runs the same scan on the cut (exit 0 and "groups ... : 0" is the pass).
- Packages CI: runs for any packages/** change, but only lints and tests packages/bun-plugin-svelte.
- on-slop.yml closes a PR when a maintainer adds a label. Nothing to check.

## 2. Probes (debug binaries, `export BUN_DEBUG_QUIET_LOGS=1`, run from /tmp/probes)

Numbers of 2026-10-30 on base 001958b155 / cut 524abcc7e3 (the src/ tree of 92d12d2992 plus one comment; the same patches as 4f0e5ee46a):

| command | base | PR |
|---|---|---|
| `$B probe-burst.mjs 24 6000 hello` | refused 15, complete 9, 15 `error ERR_QUIC_STREAM_RESET` | complete 24 |
| `$B probe-burst.mjs 100 3000 hello` | 81 lost | 0 lost |
| `$B probe-burst.mjs 16 3000 hello` | 0 lost | 0 lost |
| `$B probe-burst.mjs 100 1200 hello` | 0 lost | 0 lost |
| `$B probe-large.mjs 54 2000 10` | lost 10 of 10 (`103 true, 200 false`) | lost 0 |
| `./probe-curl.sh $B 60 3000`, 10 runs on the base | 17 to 22 x 200 (17 in 7 of 10 runs), the others `reset by server (error 0x102 INTERNAL_ERROR)` or `Failed to connect` (curl tries a second connection) | 60 x 200 in every run |
| `$B probe-destroy-direct.mjs 12 100 2000 5` | connectionLost 12 (`QPACK decompression error`) | connectionLost 12 (the case that is not fixed) |

The system bun (1.4.3) on the first row: refused 15, 24 `103`s, 9 `200`s, 24 bodies, no error.

## 3. Release builds and costs

    bun scripts/build.ts --profile=release --build-dir=build/release-measure      # PR tree
    mkdir -p /tmp/rel-pr && cp build/release-measure/bun build/release-measure/bun-profile /tmp/rel-pr/
    git checkout --no-overlay BASE -- src/ packages/
    bun scripts/build.ts --profile=release --build-dir=build/release-measure
    mkdir -p /tmp/rel-base && cp build/release-measure/bun build/release-measure/bun-profile /tmp/rel-base/
    git checkout --no-overlay HEAD -- src/ packages/
    /tmp/probes/measure.sh /tmp/rel-base; /tmp/probes/measure.sh /tmp/rel-pr
    /tmp/probes/measure.sh /tmp/rel-pr /tmp/bun-debug-pr      # adds size_of::<QuicStream>() from gdb

Executed instructions per call (gdb single-step, about 20 s each):

    cd /tmp/probes
    for v in base pr; do rm -f /tmp/host-$v.txt
      FN=Bun__Bindgen__QuicStreamPrototype__sendHeaders INNER=us_nq_stream_send_headers OUT=/tmp/host-$v.txt \
        gdb -batch -x count-instructions.py --args /tmp/rel-$v/bun-profile count-program.mjs 4 >/dev/null 2>&1
      rm -f /tmp/own-$v.txt
      FN=us_nq_stream_send_headers INNER=lsquic_stream_send_headers OUT=/tmp/own-$v.txt \
        gdb -batch -x count-instructions.py --args /tmp/rel-$v/bun-profile count-program.mjs 4 >/dev/null 2>&1
      ./count-drain.sh /tmp/rel-$v/bun-profile /tmp/drain-$v.txt 3 hello
    done

Odd calls are the client's request block (it ends the stream), even calls the server's response
block. Take the lowest "total" of each kind. Some calls have noise from the allocator.

Numbers of 2026-10-30 (base 001958b155 / cut 92d12d2992, same code as 524abcc7e3 and 4f0e5ee46a):
- .text 108,770,713 -> 108,771,481 (+768). bun-profile 317,970,008 -> 317,971,136. Stripped bun
  138,238,072 in both.
- us_nq_stream_send_headers 109 -> 122 instructions in the binary, us_quic_stream_send_headers 212 -> 211.
- Host function, response block: total 3,818 -> 3,834 (+16). Own part of us_nq_stream_send_headers 339 -> 353.
- Host function, request block that ends the stream: total 7,563 -> 7,614 (+51).
- drain_outbound own instructions per write event: 161 -> 165. send_pending_headers: 24 -> 24.
  on_stream_write: 0x11 -> 0x18 bytes (one store).
- drain_outbound calls (gdb `break *ADDR`, `ignore 1 1000000`, `info breakpoints`): 1 per stream when
  lsquic accepts every block. `probe-large.mjs 54 2000 1`: base 1 (the stream is reset), PR 2.
- size_of::<QuicStream>(): 256 in both.

## 4. Mutations (each clause has a case that fails without it)

- body loop ignores `may_hold_queued_block` -> "destroy() resets only its own stream while lsquic holds part of a response that was queued"
- flag also set for a stream's first block -> "doesn't reset a request whose stream opens behind an upload" (diff: resets 1)
- no `discard_outbound` in the queue arm -> "a large terminal response, and not the body that was written after it"
- no `discard_outbound` in the direct arm -> "destroy() after large trailers that went ahead of the body leaves the connection open"
- `note_write_blocked` unconditional -> "a response that waits behind a large interim response doesn't report its stream as blocked"
- no `note_write_blocked` in the queue path -> the burst row "behind each stream's flow-control window" (diff: blocked 0, wants 2)
- `q.push` in place of `q.insert(0, ..)` on Retry -> "three large interim responses in order, a response and its body"
- Retry keeps `headers_refused` -> "a response and its body after a response that can't be sent"

## 5. The PR

- Branch `robobun/8c601df3/queue-header-blocks` from origin/main, cherry-pick the two commits of
  `origin/robobun/8c601df3/queue-header-blocks-on-46528-v5`.
- Re-cut if #46866, #46881 or #46054 merged first. If lsquic's write check merged as
  patches/lsquic/write-while-headers-pending.patch: drop `may_hold_queued_block`, the LSQUIC_COMMIT
  export and the workarounds.ts entry, keep `end_with_header_block`, fix the body.
- Fill /tmp/pr-body.md: `__BASE__` (the sha of main), and check every number of the body against
  sections 1 to 3 (replace the numbers of 2026-10-30 when they differ). The self-review counts (32
  raised, 26 addressed) are final unless the cut changes. Visible part at
  most 250 words (`python3 -c "print(len(open('/tmp/pr-body.md').read().split('<details>')[0].split()))"`).
- Before the PR, on the main-based cut: the local checks of section 1b (clippy, cargo check, source
  lints, prettier, rustfmt, tsc, `comment-cop-scan.py origin/main`). The body's Tests paragraph
  names clippy and cargo check, so both have to be run on that cut.
- Dedupe: `gh pr list -A robobun --state open --search 'queue a header block in:title,body'`.
- `gh pr create --base main --title 'node:quic: queue a header block while lsquic still sends the previous one' --body-file /tmp/pr-body.md`
- Status comment on the PR (how it was reproduced, the PR link). No comment on #33082: #46528 closes
  it, and #46881 is the record for lsquic's write check.
- `gh pr checks <n>` a few minutes later, and again on the next wake: the GitHub Actions jobs of
  section 1b. A red `cargo clippy`, `source-lints` or autofix job that names a file of the cut is
  mine to fix at once. A Comment Cop review comment means an added comment under src/ has 2 lines.
- send_update with the PR link, then end the turn.
