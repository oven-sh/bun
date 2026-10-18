#!/usr/bin/env python3
# Writes /tmp/h2repro/final/review4.mjs: the self-review launch with the diff and the body embedded.
import json, subprocess, sys

REPO = "/workspace/bun"
head = subprocess.check_output(["git", "-C", REPO, "rev-parse", "--short=10", "HEAD"], text=True).strip()
src_diff = subprocess.check_output(
    ["git", "-C", REPO, "diff", "origin/main...HEAD", "--", "src"], text=True
)
stat = subprocess.check_output(["git", "-C", REPO, "diff", "--stat", "origin/main...HEAD"], text=True)
log = subprocess.check_output(
    ["git", "-C", REPO, "log", "--format=%h %an: %s", "origin/main..HEAD"], text=True
)
body = open("/tmp/h2repro/final/body.md").read()
third = json.load(open("/tmp/robobun-workflow-results/toolu_01952MrwVev6zDUcJcoMDyNL.txt"))

diff_text = (
    "NOTE: this is the src/ part of the diff only (production code and the Rust unit tests). "
    "The test files are not inlined: read them in the checkout. Full diff: `git -C /workspace/bun diff origin/main...HEAD`.\n\n"
    "Commits (newest first):\n" + log + "\nDiffstat:\n" + stat + "\n" + src_diff
)

env_preamble = f"""The change under review is NOT on GitHub yet. Read it from the checkout: `git diff origin/main...HEAD` in /workspace/bun (HEAD = {head}, branch robobun/d972025c/http2-native-stream-limit; per commit: `git log --stat origin/main..HEAD`). PR oven-sh/bun#44337 on GitHub still shows an OLDER head (feab025f05, which had a same-read slot hold that this re-cut removed) and an older body: do not review that diff or that body. The PR body that will be published with this diff is the file /tmp/h2repro/final/body.md. Binaries: /workspace/bun/build/debug/bun-debug is a debug+ASAN build of this HEAD's src/ (run it directly, with BUN_DEBUG_QUIET_LOGS=1); `bun` on PATH is released Bun 1.4.3; `node` on PATH is Node.js v26.3.0. Do NOT run `bun bd`, `bun run build`, cargo, or any other build, and do not change, stage, check out or stash any file under /workspace/bun: another build uses this tree at the same time. Write probe scripts under /tmp only."""

extra_context = """This diff is the re-cut that the previous self-review of oven-sh/bun#44337 asked for (its disposition was 'restructure'; its wanted verdict is passed as earlier_verdict, with the shape it asked for). What changed since the head that review read (feab025f05):
1. The same-read slot hold is removed: ReadScope, closing_in_read, ended_in_read, in_read, Sink::on_peer_reset and the release_peer_slot / release_peer_slot_now split are gone. A slot is free when its stream closes (Stream::free_resources or H2FrameParser::close_unsent), as on Bun 1.4.3. One Bun-only test pins that timing.
2. alii's commit 18c2e930f7 of #37985 (Connection::last_peer_stream_id, BlockDisposition::StreamClosed = decode and drop) is carried, rebased, with alii as the author. BlockDisposition::Ignored and the HEADERS use of refused_ids are gone. refused_ids stays for the two DATA arms only, which is what the previous review's finding 'bigger-shape:closed-id-mark-first-step' recommended (its alternative was to carry #42467 as well).
3. One PR on main. The stack is: the three commits of #44248 unchanged, the pins (this was #44335: 33 tests and two helpers, no behaviour change), alii's commit, the limit.
4. The other writers of rejected_streams (memory refusal, malformed block, oversized header list) stay out, as that review decided. The body says so under 'Not changed'.
5. The body states both reach populations with numbers, the #31584 history, two open questions for a maintainer, and has no links to #44536 / #44537 / #44538.

Design picked before the code was written: refuse in the engine. Connection::handle_headers tests the advertised limit before it makes a stream entry (the place where the memory refusal of #33072 already is), the embedder (H2FrameParser) keeps an O(1) count of the open peer streams behind two Sink getters, the refusal is charged to node's budget (maxSessionInvalidFrames) through Connection::count_invalid_frame, and the JS count is deleted. Because: the engine is the component that opens the stream, so after the fix nothing opens a stream that must be refused; a refused stream costs no Box<Stream>, no map insert and no JS call; alii asked for an engine-side O(1) count on #32675. Why not the minimal patch: moving only the charge (JS returns the code, native charges the invalid-frame budget) keeps the open-then-refuse path, the JS count with its two defects, and the per-refusal allocation and JS calls.

Things worth a probe: the interplay of alii's mark with the refusal (the mark is raised for a refused id, so a trailer block on a refused id is a closed-stream block); DATA on a refused stream (refused_ids); the count at every exit of a stream (holds_peer_slot; assert_peer_slots runs once per read in debug builds); that every test of test/js/node/http2/node-http2-max-concurrent-streams.test.ts passes on node v26.3.0 (`node test/js/node/http2/node-http2-max-concurrent-streams.test.ts`) and on the debug build; that the body's claims match the code."""

linked = """- oven-sh/bun#44337: the PR that this diff will be pushed to (draft; the head on GitHub is older, see above).
- oven-sh/bun#44248 (open, robobun): its three commits are the first three commits of this stack, unchanged.
- oven-sh/bun#44335 (open draft, robobun): the pins. Folded into this stack as one commit; it will be closed.
- oven-sh/bun#37985 (open, alii): the closed-id mark. Its commit is carried here with alii as the author. robobun asked there on 2026-10-02 how to proceed; no answer.
- oven-sh/bun#31584 (merged 2026-06-17 by cirospaciari): added the JS enforcement of the limit and the charge to maxSessionRejectedStreams.
- oven-sh/bun#32675 (closed): an earlier engine-side attempt; alii asked there for an O(1) count.
- Issues oven-sh/bun#44536, #44537, #44538: filed by robobun for follow-ups, closed as not planned by Jarred-Sumner on 2026-10-08.
- No user report: the bug was found by inspection."""

open_prs = """Open PRs on the same lines of connection.rs / h2_frame_parser.rs: #42467 (DATA on a closed stream, has_existed / is_closed_stream), #37588 (GOAWAY last-stream-id, last_proc_stream_id), #43475 (HEADERS after a GOAWAY this side sent), #42522 (glitch rate limit), #40240 (request() exits and state writers), #43539, #41305."""

earlier = dict(third["wanted"])
earlier["what_would_be_wanted"] = third["disposition"]["bigger_shape"]

args = {
    "diff_text": diff_text,
    "pr_title": "node:http2: refuse a stream over the advertised limit before it is opened, on maxSessionInvalidFrames",
    "pr_body": body,
    "extra_context": extra_context,
    "linked": linked,
    "open_prs": open_prs,
    "earlier_verdict": earlier,
    "env_preamble": env_preamble,
}

js = (
    'import run from "robobun:rdr";\n\n'
    "export const meta = {\n"
    '  name: "rdr-self-review",\n'
    '  description: "Self-review of a diff that is not on GitHub yet. The diff and the PR body are embedded in the script.",\n'
    '  phases: ["Disposition", "Survey", "Probe", "Refute", "Steelman", "Synthesize"],\n'
    "};\n\n"
    "const embedded = " + json.dumps(args, ensure_ascii=True) + ";\n\n"
    'export default await run({ ...embedded, ...args, mode: "pushback", cwd: "/workspace/bun" });\n'
)
open("/tmp/h2repro/final/review4.mjs", "w").write(js)
print("head", head, "diff bytes", len(diff_text), "body bytes", len(body), "script bytes", len(js))
