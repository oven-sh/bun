Right, and `main` has the same exits: the state goes to CLOSED, no frame is written, and `free_resources` does not run. `close_unsent` only gives those six exits one name.

The slot is given back there because 1.4.3 gives it back there (its JS count goes down in `streamError`). Four tests of this PR pin that: `a slot is free again > after respond() failed for ...`.

The missing RST_STREAM is a separate defect and this PR does not change it. #43478 and #43419 remove two of the ways to make `respond()` fail. I added it to "Left for later" in the PR body.
