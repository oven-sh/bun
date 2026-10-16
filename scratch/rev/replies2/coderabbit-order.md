Applied in @@SHA@@. The arm now tests the native class first, so `href` of a value that is not a URL is not read.

- `util.inspect(new Broken())`, where `class Broken { get href() { throw new Error("boom") } }`, prints `Broken {}` again, as on main.
- Of 30 value shapes that are not a URL, each with a counting `href` getter, `util.inspect` reads 0 (Node v26.3.0 reads 9, the first push of this PR read 9).

This is a departure from Node's `isURL()`, which reads `href` first. The PR body states it under "Unlike Node" for a maintainer to accept.
