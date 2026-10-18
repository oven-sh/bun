#!/usr/bin/env python3
# Fills body.tmpl3.md into body.md. usage: fill-body.py <cost line file> <measure block file>
import re, sys
s = open('/tmp/h2repro/final/body.tmpl3.md').read()
cost = open(sys.argv[1]).read().strip()
measure = open(sys.argv[2]).read().strip()

def rep(old, new, count=1):
    global s
    assert s.count(old) == count, (s.count(old), old[:70])
    s = s.replace(old, new)

rep("#31584 added that charge on the premise that nghttp2 does the same. It does not.",
    "#31584 chose that budget on a wrong premise about nghttp2 (Notes).")
rep("- Self-reviewed: SELF_REVIEW_LINE", "- Self-reviewed: 48 concerns raised, 35 addressed (Notes).")
rep("- Two questions for a maintainer are in Notes: the budget move, and a limit that the client ACKed.",
    "- Notes has two questions for a maintainer: the budget move, and a limit that the client ACKed.")
rep("""- A server that lowered `maxSessionInvalidFrames` ends the session at refusal max + 2, as node does.
- `refused_ids` keeps 4 bytes for each refused stream. The invalid-frame budget bounds it: 4 KB at the default.
- Cost: COST_LINE
""", """- These refusals use `maxSessionInvalidFrames` (default 1000), not `maxSessionRejectedStreams` (default 100). A server that set either option sees another count.
- Cost: """ + cost + "\n")

rep("**The self-review.** SELF_REVIEW_BLOCK", """**The self-review.** Three reviews. The first asked for tests that pass on node, and for node's slot timing or a maintainer's word. The second asked for `node:test`, and found approximations in the slot timing. The third measured that the slot timing cannot follow node and costs requests that Bun serves today, so it is removed. It also asked for this packaging: one PR on `main`, and the two questions above. Of its 48 findings, 35 are taken. Six are left as they are and are in the lists above (the other rejection budgets, the client cap, the answered upload, the frame-header timing, `#connections`). One needs no action. Not taken:
- The commit of #37985 in place of `refused_ids` (3 findings). The reason is under "The refused ids".
- A seeded corpus of request flights in place of the fixed tests. The tests that remain do not depend on timing inside a read.
- A CI job for the Rust tests of `connection.rs`. CI type-checks them and runs none of them, as for the other tests of that file. I ran them with the engine sources in a standalone crate: 28 pass.
- To delete the rewritten test of `node-http2-rejected-streams.test.ts` in place of the rewrite.""")

rep("**Suites on a debug build:** SUITES_LINE", """**Suites on a debug build of this head**, with a 60 s test timeout: the 261 `test-http2-*` files of `test/js/node/test` all exit 0. All 13 files of `test/js/node/http2/` pass (`node-http2.test.js` 405 pass and 6 skip, `h2-conformance.test.ts` 84, `node-http2-client-close.test.ts` 69, `node-http2-max-concurrent-streams.test.ts` 60, `node-http2-rejected-streams.test.ts` 16). Of the 29 grpc-js files, 27 pass. `test-client` (3 tests) and `test-resolver` (5 tests) fail in this container: they need DNS, or they have a 100 ms deadline that a debug build misses. On release builds of `main` and of this head the same number of their tests fail (2, and 5 or 6).""")

rep("**Measurements.** MEASURE_BLOCK", "**Measurements.** " + measure)

open('/tmp/h2repro/final/body.md', 'w').write(s)
vis = s[:s.index('<details>')]
toks = [t for t in re.findall(r"\S+", vis) if t not in ('###', '-')]
print('visible words:', len(toks), ' total bytes:', len(s))
for bad in ('\u2014', '\u2013', ' -- ', 'SELF_REVIEW', 'COST_LINE', 'SUITES_LINE', 'MEASURE_BLOCK', 'FRAMES_', 'HEAD_SHA'):
    if bad in s: print('LEFTOVER:', repr(bad))
if ';' in vis: print('semicolon in visible part')
