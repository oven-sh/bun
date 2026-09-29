### Problem
- After `warn: Ignoring lockfile`, `bun install` fails with `error: GET http://localhost:37421/ - 404` and `error: kept@^1.0.0 failed to resolve`, or installs another package under that name.
- The lockfile loaders registered each `npm:` alias they read (`src/install/dependency.rs:1183`). The entries stayed when bun ignored the lockfile or package.json dropped the entry.

### Fix
- The loaders of bun.lock, bun.lockb and the three migrations register no alias.
- bun registers the dependency rows of a bun.lockb, package-lock.json or yarn.lock when it keeps the lockfile, which then resolves as on main.
- Override and catalog aliases come from package.json. The runtime takes them from the bun.lockb it keeps.
- Verified: 17 tests (11 fail on main) in `bun-lock.test.ts`, `bun-lockb.test.ts`, `migration/migrate.test.ts`, `run-autoinstall.test.ts`.

### Background
- `"kept": "npm:short@1.0.0"` installs `short` as `kept`. The resolver also sends a plain `kept@^1.0.0` of another package to that alias (`PackageManagerEnqueue.rs:803`).
- A name over 8 bytes is an offset into the string buffer of its lockfile.
- Considered: clear the map at each reset (misses the kept lockfile), register no lockfile row (changes kept bun.lockb results), keep aliases in the load result (each load pays).

### Downsides
- Behavior change with bun.lockb: the alias of an override for one parent no longer applies to every package. bun.lock never applied it.
- A kept bun.lockb, package-lock.json or yarn.lock costs about 940 instructions more per alias row. Release `.text`: +256 bytes.
- Still wrong: a kept bun.lockb registers the alias row of a package that the install removes.
