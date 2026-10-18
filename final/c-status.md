Status: STATUS_LINE

This PR is now one PR on `main`, with one commit for each part:

1. #44248, as it is.
2. The pins (this was #44335).
3. The commit of #37985, rebased, with alii as the author.
4. The limit: a stream over the advertised limit is refused in the engine before it is opened, on node's budget (`maxSessionInvalidFrames`), with an O(1) native count.

Removed since the last status: the rule that held a slot until the end of the read. A slot is free when its stream closes, as on Bun 1.4.3. The PR body says why.

Two questions wait for a maintainer. Both are in the PR body:

- The budget move itself (`maxSessionRejectedStreams` to `maxSessionInvalidFrames`), which #31584 chose the other way.
- A stream over a limit that the client ACKed. Node ends the session. This PR refuses the stream.

How I reproduced the bug: a server with `settings: { maxConcurrentStreams: 10 }` whose handler keeps each stream open, and a raw HTTP/2 client that sends the preface, an empty SETTINGS frame and 150 complete requests in one write, then a PING.

- Bun 1.4.3: 10 handlers, 99 RST_STREAM(REFUSED_STREAM), GOAWAY(ENHANCE_YOUR_CALM), `ERR_HTTP2_SESSION_ERROR`.
- node v26.3.0 and this branch: 10 handlers, 140 RST_STREAM(REFUSED_STREAM), the PING is answered, the session stays open.

The tests: `bun bd test test/js/node/http2/node-http2-max-concurrent-streams.test.ts`. On Bun 1.4.3, 22 of the 26 tests of the new block fail. With this change all 60 pass. The last test runs the file on Node.js v26.3.0: 52 pass, 7 are skipped as Bun only ([report](https://github.com/oven-sh/bun/pull/44337#issuecomment-5949423804)).
