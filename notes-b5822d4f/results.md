# Measurements (base = origin/main a4f1429148, PR = final source of the branch)

1. record_npm_alias calls (gdb breakpoints, debug builds):
   - bench/bundle (bun.lockb, 102 dependency rows, 100 npm: rows): `bun pm hash` 100 -> 0, map grows 5 -> 0; `bun install --dry-run` 300 -> 300 (100 of them now from the pass over the kept rows).
   - bun.lock with 50 flat alias overrides: `bun pm hash` 50 -> 0, grows 4 -> 0; `bun install --dry-run` 150 -> 100.
2. instructions (gdb stepi, release profile builds):
   - buffers::load, bench/bundle, `bun pm hash`: 169,808 -> 112,383.
   - kept bun.lockb, bench/bundle (100 alias rows), `bun install --dry-run`: buffers::load 169,906 -> 111,110, the new pass 153,549. Net +94,753, about +950 for each alias row.
   - kept bun.lockb, bench/express (146 rows, no alias), `bun install --dry-run`: buffers::load 134,960 -> 134,082, the new pass 1,047. Net +169.
3. hot paths (objdump of release builds): enqueue_dependency_with_main_and_success_fn 4095 instructions, 0 changed; parse_with_tag 956 instructions, 0 changed.
   No-op install instruction count: not measured. perf and valgrind cannot be installed here (apt has no source for them, perf_event_paranoid=4). A gdb stepi count of the bun.lock load of bench/install did not finish in 40 minutes.
4. release sizes (size -A, nm -S): .text 58,143,477 -> 58,143,733 (+256 bytes). New: record_npm_aliases 533 bytes, record_override_and_catalog_aliases 193 bytes.
   put_lockfile_rule 3335 -> 3227; buffers::load 4510 -> 4490; parse_into_binary_lockfile 48463 -> 48233; Lockfile::load_from_bytes 11263 -> 11150; install_with_manager 42089 -> 42164; runtime init closure 10630 -> 10703; npm_lock::migrate_packages 12401 -> 12414.
5. kept lockfile matrix (release builds): 128 cells = {bun.lock, bun.lockb, package-lock.json, yarn.lock} x {root, workspace, transitive, override for one parent, override for one range (the two override sources with bun.lock and bun.lockb only)} x {install in sync, add kept@^1.0.0, add extra, update} x {5, 18 byte target}. No pnpm-lock.yaml column and no `resolutions` row.
   changed: 10 of 128. package.json-declared (root, workspace) cells changed: 0 of 64. transitive cells of bun.lockb and package-lock.json changed: 0 of 16. bun.lock cells changed: 0 of 40.
   - bun.lockb, override for one parent and override for one range, add kept@^1.0.0 and add extra (8 cells): the new plain edge gets the registry package of its name. Same rows as bun.lock. Requests: /kept in place of the alias target. +1 package where the parent keeps the alias target.
   - yarn.lock transitive, 18 byte target, add kept@^1.0.0 and add extra (2 cells): exit 1 (`GET <registry>/alias-some-other-p - 404`, `kept@^1.0.0 failed to resolve`) -> exit 0 with the rows that the 5 byte target gets on main.
6. runtime init (bun.lockb with 2 root alias rows and 2 transitive alias rows, `bun --install=fallback index.js`, debug builds): record_npm_alias 6 -> 6 (4 from the passes), each pass runs 1 time. Without bun.lockb: 2 -> 2, passes entered 0 times. bun.lockb that fails to load: 6 -> 2, passes entered 0 times.

# Other probes (release builds of base and PR unless noted)

- package.json drops an installed alias override (full install, bun.lock and bun.lockb): base prints "(no changes)" and keeps the alias target; PR installs the registry package ("2 packages installed"). An applied catalog alias keeps the alias target on both builds (the edited dependency keeps its locked package because the version is in the new range).
- npm 11.16.0, same edit after an install with the override: "up to date", keeps the fork (measured by the review on this branch). npm for the never-applied rows: the registry package.
- bun.lockb where a registry package declares `kept: npm:ws-pkg@^1.0.0` and ws-pkg is a workspace at 1.0.0, `bun add new-dependency` (plain kept@^1.0.0): base requests /new-dependency only and reuses the workspace link; PR requests /kept and adds `new-dependency/kept: kept@1.0.0`. bun.lock gives the PR result on both builds.
- package-lock.json row ` npm:short@1.0.0` (space in front): followed on base and on the PR (the pass trims like the migration).
- `$name` override that reads the root row of a migrated package-lock.json: base and PR agree in all 16 cells of test/cli/install/scratch/dollar-probe.ts.
- yarn.lock that bun reads and does not use (root without dependencies), `bun add new-dependency`, rows in dependencies / optionalDependencies / peerDependencies / devDependencies: base exits 1 with `Registry URL must be http:// or https://`; PR exits 0.
- yarn.lock project, transitive alias to an 18 byte target, `bun update dependency-of-some-other-package`: base and PR both exit 1 with `GET <registry>/:%2f%2flocalhost:PORT - 404` (the row's own target name is sliced from the wrong buffer, yarn.rs second-phase sites). Not changed here.
- runtime with bun.lock next to bun.lockb: dependency rows not followed, overrides and catalogs followed, on both builds. bun.lock alone: the runtime loads no lockfile.
- residual (kept bun.lockb / package-lock.json, root dropped its alias dependency, a new plain dependency of that name): alias target on base and PR; bun.lock and no lockfile give the registry package.

# Mutants (debug build, all killed)

- install keep-site pass disabled: 3 "follows the alias that a package of the lockfile declares" tests fail.
- install keep-site pass moved above the needs_new_lockfile break: the 4 yarn.lock not-used tests fail.
- runtime calls disabled: "a package that is not in bun.lockb follows the aliases" fails.
- runtime `format == Binary` gate removed: "a dependency row of bun.lock registers no alias" fails.
- override and catalog loops of the runtime pass removed: catalog names of the runtime control change.
- trim removed (release build of 04f38c0d8d): the package-lock.json control with a space in front fails.
- yarn.rs and pnpm.rs of main: the source lint reports the 7 yarn.rs calls.
