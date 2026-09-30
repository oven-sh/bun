**Status:** ready for review.

How I reproduced it, on bun 1.4.3-canary.1 (367d939d9) and on main, with a local registry that has `kept@1.0.0`, `short@1.0.0` and `some-other-package@1.0.0`:

1. package.json has `"dependencies": {"kept": "^1.0.0"}` and `"overrides": {"kept": "npm:short@1.0.0"}`. Run `bun install`, delete `overrides`, run `bun install` again. bun prints `(no changes)` and `node_modules/kept` is still `short`.
2. The same package.json without `overrides`, next to a bun.lock that has the override and fails to load (`warn: Ignoring lockfile`). `node_modules/kept` is `short`. With the target `some-other-package` the install fails with `error: GET <registry>/ - 404` and `error: kept@^1.0.0 failed to resolve`.

PR: #44294
