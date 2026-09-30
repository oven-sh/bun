Confirmed on main and on this branch, and not changed here. `bun update dependency-of-some-other-package` right after the migration requests `<registry>/:%2f%2flocalhost:PORT` and exits 1. #44298 tracks it with the reproduction.

I left it out of this PR because it is wider than aliases. `SlicedString::init(literal, literal)` is also in `process_deps` (`yarn.rs:573` on main), and `Dependency::parse` slices git and GitHub references, tarball URLs, folder paths and dist-tags from the same buffer. A change of the base changes all of those rows, and each kind needs a test of its own.
