### Problem
- With `globalStore = true` and a cache that the user cannot write, a missing store entry fails with `ENOENT: No such file or directory: failed to link package: plain@1.0.0 (link)`. The real error is the `mkdir`: `EACCES` or `EROFS`.
- Cause: `Hardlinker::link` (`src/install/isolated_install/Hardlinker.rs:248`) drops the result of `make_path` after `linkat` fails with `ENOENT`, then links again. Nine more sites do the same.
- Since #44968 (unreleased), that `mkdir` error can read as a refused hardlink: `EPERM ... (copyfile)`, and 1 to 36 of 120 later packages are copied.

### Fix
- The backends return a `LinkError`: `Destination` (a directory could not be made) or `Link` (the link failed). Only `Link` can change the backend. The hardlink backend makes a new package directory before the first link.
- The install prints `EACCES: ... cannot create "<cache>/links" (mkdir)` and a note that names the setting. It still exits 1.
- Verified: `test/cli/install/isolated-install.test.ts` (18 new tests, 15 fail on main), `bun-patch.test.ts` (3 new), 19 install suites.
- Self-reviewed: 16 concerns raised, 12 addressed. Rejected (reasons in Notes): a separate guard PR, a repo-wide lint, the `EEXIST` arms, a backend hint per destination.

### Background
- The isolated linker builds a store entry in `node_modules/.bun/`, or in `<cache>/links/` with the global store, through one backend: clonefile, hardlink or copyfile. A refused link moves the whole install to copyfile.
- Weighed: build the missing entry in the project (no maintainer has ruled on it, so exit 1 stays), and delete the `ENOENT` retry (concurrent installs need it).

### Downsides
- Failure output changes: `.bin` and `bun patch` print `EACCES` where main prints `ENOENT` and `EPERM`.
- Release binary, Linux x64: `.text` +4,608 bytes, file +8,192 bytes.
- `globalStore = false` on that cache still fails when a lifecycle script runs, until #46100.
