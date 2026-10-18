Kept as it is, on purpose.

- The tests must pass on Bun and on Node.js v26.3.0. That is the maintainers' request on #37588 and #41305, and `.claude/docs/landing-prs.md` asks for `node:test` and `node:assert` "so the identical file passes under real Node".
- The shape is the one already in the tree: `test/js/node/http/node-http-agent-free-socket.test.ts` and five more files are written for `node:test` and end with the same test that starts Node.js on the file.
- `node:test` has no `test.each`, hence the two small helpers.
- `node-http2-rejected-streams.test.ts` is the file of #44248. This PR changes one test in it.
