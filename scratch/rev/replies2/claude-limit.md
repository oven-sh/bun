Confirmed, and fixed in @@SHA@@ in two places.

1. The arm tests the native class before it reads `href`. A value that is not a URL cannot throw there, so `assert.deepStrictEqual({ a: new Broken() }, { a: 1 })` gives the AssertionError again.
2. The AssertionError constructor restores `Error.stackTraceLimit` in a `finally`, and its inspect hook restores the two operands in a `finally`. Of 24 inputs that make the constructor exit by a throw, 17 leave the limit at 0 on 1.4.3, 16 on Node v26.3.0, and 22 with the first push of this PR. Now 0 do. The store and the restore are each in a `try` with an empty `catch`, so a limit that is not writable gives the AssertionError as on Node (main throws a `TypeError` there).

Node has the same plain restore (`lib/internal/assert/assertion_error.js:353`), so the PR body states this as a departure for a maintainer to accept. #45177 wraps the same block in try/finally with another mechanism. The second of the two to land rebases.
