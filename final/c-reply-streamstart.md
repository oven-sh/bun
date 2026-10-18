The stream in that case is open on the wire and has an entry in both native tables, so it holds a slot as any open stream does (RFC 9113 5.1.2). The base did not count it because its counter was raised inside the callback that did not run.

What is wrong there is the stream itself: nothing resets a stream for which `streamStart` made no JS stream, so it stays until the peer resets it. Node resets such a stream. This PR does not change that. With the count in native code the number of such streams is now bounded by the limit, where the base admitted them without a bound.

I added it to "Left for later" in the PR body.
