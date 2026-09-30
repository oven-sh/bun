### Problem
- After package.json drops the override `"kept": "npm:short@1.0.0"`, `bun install` prints `(no changes)` and keeps `short` in `node_modules/kept`.
- After `warn: Ignoring lockfile`, the install can fail: `error: GET http://localhost:37421/ - 404`, `error: kept@^1.0.0 failed to resolve`.
- Cause: the lockfile loaders register `npm:` aliases while they parse (`src/install/dependency.rs:1186`). Nothing removes an entry.

### Fix
- No lockfile loader registers an alias. The compiler or a source lint enforces it.
- `Lockfile::record_dependency_row_aliases` registers the rows of a kept bun.lockb, package-lock.json or yarn.lock, as main did. Override and catalog aliases come from package.json.
- Verified: 28 new tests, 20 fail on main (`bun-lock.test.ts`, `bun-lockb.test.ts`, `migration/migrate.test.ts`, `run-autoinstall.test.ts`). Other suites are in Notes.
- Self-reviewed: 28 concerns raised, 26 addressed. Rejected: wrongly sliced yarn.lock row names and unread `pnpm.overrides`, both separate defects.

### Background
- `"kept": "npm:short@1.0.0"` installs `short` as `kept`. bun then sends a plain `kept@^1.0.0` of any package to `short` (`PackageManagerEnqueue.rs:803`).
- A lockfile stores a name over 8 bytes as an offset into its string buffer, which a discard frees.
- Considered: clear the map at each lockfile reset. The dropped override stays.

### Downsides
- Behavior change: after an `npm:` override leaves package.json, the next install takes the registry package. npm 11 keeps the fork. Notes list the narrower changes.
- Still wrong: a kept bun.lockb or package-lock.json sends a new dependency to an alias that package.json dropped (#44292).
- Cost: about 950 instructions per alias row of a kept bun.lockb, package-lock.json or yarn.lock, and 256 bytes of release `.text`.

<details><summary>Notes</summary>

**Reports.** No user reported this trigger. It was found during other install work. #23264 and #28674 show the same error text with another trigger: the alias is still declared in another workspace. That trigger belongs to #43515.

**Reproduction.** The registry has `kept@1.0.0`, `short@1.0.0` and `some-other-package@1.0.0`. Canary 367d939d9 and main give the same results.

1. Dropped override. package.json has `"dependencies": {"kept": "^1.0.0"}` and `"overrides": {"kept": "npm:short@1.0.0"}`. Run `bun install`, delete `overrides`, run `bun install`.
   - main, bun.lock and bun.lockb: `Checked 1 install across 2 packages (no changes)`. `node_modules/kept` is `short`.
   - this PR: `+ kept@1.0.0`, `1 package installed`. `node_modules/kept` is `kept`.
2. Discarded lockfile. package.json has `"dependencies": {"kept": "^1.0.0"}`. bun.lock (`lockfileVersion` 2) has `"overrides": {"kept": "npm:short@1.0.0"}` and a `packages` row with no integrity hash. bun prints `error: Missing integrity`, `InvalidLockfile: failed to parse lockfile: 'bun.lock'`, `warn: Ignoring lockfile`.
   - main: exit 0, `+ kept@1.0.0`, and `node_modules/kept` is `short`. With the target `some-other-package` (over 8 bytes): exit 1, `error: GET <registry>/ - 404`, `error: kept@^1.0.0 failed to resolve`.
   - this PR: `node_modules/kept` is `kept` for both targets.

A lockfile that bun accepts installs the same packages on both builds. This PR gives no protection against a person who can write the lockfile.

**Fail before.** With `src/` of main, 20 of the 28 new tests fail on the debug (ASAN) build and on canary 367d939d9. The other 8 pin results that must not change and pass on both builds:
- a new dependency follows an alias that package.json declares (bun.lock, bun.lockb)
- a new dependency follows the alias that a registry package of a kept bun.lockb or package-lock.json declares, and does not follow it with bun.lock
- the runtime follows the aliases of a kept bun.lockb, and a dependency row of bun.lock registers none

`test/internal/source-lints/lockfile-migration-alias-registry.test.ts` reports 7 calls in `yarn.rs` on main.

**Where the rule is enforced.**
- bun.lock and bun.lockb: `TextLockfile::parse_into_binary_lockfile`, `Serializer::load`, `buffers::load` and `Lockfile::load_from_bytes` take `Option<&PackageManager>`. `OverrideMap::put_lockfile_rule` and `dependency::Context` have no registry.
- package-lock.json: `Migrator.manager` is `&PackageManager`. #43103 adds a row parse with `Some(&mut *self.manager)` there. After this PR the compiler rejects it, and it needs `None`.
- yarn.lock and pnpm-lock.yaml: these migrations keep `&mut PackageManager` for the package.json cache and the manifest cache. The lint checks that each dependency parse call in `yarn.rs` and `pnpm.rs` passes `None`. A type split of their row phase is a possible follow-up.
- The runtime reads no overrides or catalogs from package.json. It calls `Lockfile::record_override_and_catalog_aliases` for the bun.lockb it keeps.

**All behavior changes.** Release builds of main a4f1429148 and of this PR.
- The dropped override above, with bun.lock and bun.lockb. The same for override and catalog rows that package.json dropped before they were applied.
- bun.lockb, alias override for one parent (`"overrides": {"parent": {"kept": "npm:short@1.0.0"}}`) or for one range (`"kept@2": "npm:short@1.0.0"`). On main, `bun add` of a package with a plain `kept@^1.0.0` gets the alias target. Now it gets the registry package. bun.lock gives this result on both builds.
- bun.lockb, an alias row that the loader links to a workspace. On main, `bun add new-dependency` reuses the workspace link for its `kept@^1.0.0`. Now it adds `new-dependency/kept: kept@1.0.0`. bun.lock gives this result on both builds.
- package.json has the alias in `resolutions`, and an `overrides` key appears. bun then reads only `overrides`. main keeps `short@1.0.0` through the lockfile entry. This PR installs `kept@1.0.0`. #38811 makes both keys apply.
- A pnpm-lock.yaml that fails to migrate after its `overrides`. main follows those aliases. This PR installs the registry packages. bun reads `pnpm.overrides` of package.json only at the end of a migration that succeeds (`update_package_json_after_migration`), for every kind of value. #38754 imports pnpm-workspace.yaml when no pnpm-lock.yaml can be migrated.
- yarn.lock, a registry package holds an alias to a target over 8 bytes. On main, `bun add` exits 1 with `GET <registry>/alias-some-other-p - 404`. Now it exits 0 with the rows that a short target gets on main.
- package-lock.json rows that the migration parses and then skips (a duplicate peer row, a row whose package is not in the lockfile) registered an alias on main. Now they register none. This is from a read of `npm_lock.rs`. No test covers it.
- Runtime auto-install: a bun.lockb that fails to load registers nothing.

Kept lockfile matrix: 128 cells of {bun.lock, bun.lockb, package-lock.json, yarn.lock} x {root, workspace, registry package, override for one parent, override for one range} x {install, add kept@^1.0.0, add extra, update} x {5 byte target, 18 byte target}. 10 cells changed: the 8 bun.lockb override cells and the 2 yarn.lock cells above. 0 of 64 cells with an alias that package.json declares changed. 0 of 40 bun.lock cells changed. The matrix has no pnpm-lock.yaml column and no `resolutions` row.

**Not changed.**
- #44292: a kept bun.lockb or package-lock.json with an alias row that package.json no longer reaches.
- An installed catalog alias stays on both builds when the dependency changes from `catalog:` to a range that the locked version is in.
- The writers of the map that remain: the package.json parses, the CLI arguments of `bun add`, the package.json reads of the runtime resolver, and the clone paths of `Dependency` (the differ, `clean_with_logger`, the package.json write-back).
- A `$name` override of a migrated lockfile goes through `OverrideMap::parse_append` with the registry (`npm_lock.rs:1028`, `yarn.rs:1989`). It reads the root package.json, like the parse of the install itself. main and this PR agree in all 16 cells of a probe for it.
- npm 11.16.0 after the override is deleted prints `up to date` and keeps the fork.

**Found, not changed here.**
- The yarn.lock migration parses a dependency row with the literal as its own buffer (`yarn.rs`, five `SlicedString::init` calls of the second phase). A target name over 8 bytes is then wrong in the row. `bun update dependency-of-some-other-package` right after the migration requests `<registry>/:%2f%2flocalhost:PORT` and exits 1, on main and with this PR. The new pass parses the literal again with the lockfile buffer, so the alias it registers is right. I found no open PR for this.
- A yarn.lock with no entry for a dependency of package.json: `error: added-later@1.0.0 failed to resolve`, exit 1, on canary, main and this PR. No alias is involved.
- `isolated-install.test.ts`, "ranged peer dependency resolution is stable across installs from bun.lock": 1 of 2 runs failed on the debug build of main.

**Related open PRs.**
- #43515 stores the specifier text in the map. It has the user reports and can go first. This branch merges with it and type-checks. After it, the new pass can call `record_npm_alias(row.name_hash, literal)` with no parse.
- #43375 clears the map and builds it again from the rows that the install reaches, for the rows it resolves again. #43267 and #43981 read the map.
- Draft #36476 removes the map.

**Alternatives.**
- Clear the map at each `Lockfile::init_empty` of a loaded lockfile. It covers the discarded lockfile only. The loaders keep the write, and each new reset site must repeat the call.
- Collect the aliases while the loader parses, and register them at the keep site. It repeats what main registers, with the yarn.lock names that the migration slices from the wrong buffer.
- Register no lockfile row at all. It changes what a new dependency gets with a kept bun.lockb or package-lock.json when a locked registry package holds the alias. That is option 2 of #44292.

**Measurements.** Base a4f1429148 against this PR before the rebase.
- `record_npm_alias` calls (gdb breakpoints, debug builds). `bench/bundle` (bun.lockb, 100 alias rows): `bun pm hash` 100 to 0, `bun install --dry-run` 300 to 300 (100 from the new pass). A bun.lock with 50 alias overrides: 50 to 0, and 150 to 100.
- Instructions (gdb `stepi`, release builds). `buffers::load` of `bench/bundle` for `bun pm hash`: 169,808 to 112,383. Kept bun.lockb of `bench/bundle`, `bun install --dry-run`: load 169,906 to 111,110, new pass 153,549, net +94,753, about 950 for each alias row. Kept bun.lockb of `bench/express` (146 rows, no alias): load 134,960 to 134,082, new pass 1,047, net +169.
- Hot paths (objdump, release builds): `enqueue_dependency_with_main_and_success_fn` 4095 instructions, 0 changed. `parse_with_tag` 956 instructions, 0 changed.
- Release `.text` (`size -A`): 58,143,477 to 58,143,733 bytes. New: `record_npm_aliases` 533 bytes, `record_override_and_catalog_aliases` 193 bytes.
- Runtime init with a bun.lockb that has 4 alias rows, `bun --install=fallback index.js`: `record_npm_alias` 6 to 6. A bun.lockb that fails to load: 6 to 2.
- Not measured: the instruction count of a whole no-op install. `perf` and `valgrind` cannot be installed in this container, and a gdb `stepi` count of it did not finish in 40 minutes.

**Mutants.** Each one fails at least one new test on the debug build.
- The pass at the install keep site removed: the controls where a new dependency follows the alias of a kept bun.lockb, package-lock.json or yarn.lock fail.
- That pass moved above the `needs_new_lockfile` break: the 4 yarn.lock discard tests fail.
- The runtime calls removed: "a package that is not in bun.lockb follows the aliases" fails.
- The runtime `format == Binary` check removed: "a dependency row of bun.lock registers no alias" fails.
- The trim removed: the package-lock.json test with a space in front fails.

**Suites.** Debug build, final source. After the rebase on 2722608f47: `bun-lock` (47), `bun-lockb` (17), `migration/migrate` (138), `run-autoinstall` (15) and all of `test/internal/source-lints` (172). Before the rebase, with the same `src/install`: `yarn-lock-migration`, `pnpm-lock-migration`, `pnpm-lock-v9`, `pnpm-migration`, `pnpm-comprehensive`, `pnpm-migration-complete`, `overrides`, `nested-overrides`, `catalogs`, `bun-workspaces`, `bun-add`, `bun-add-catalog`, `bun-add-filter`, `bun-update`, `bun-update-transitive`, `bun-update-lockfile-sync`, `bun-remove`, `bun-pm`, `bun-dedupe`, `bun-install-registry`, `autoinstall-cached-manifest`, `run-autoinstall-abs-path`. `bun-install`: 245 pass, and the 13 tests that need an outside host fail as they do on main. `isolated-install`: 84 of 85, see above. `bun run rust:check-all` passes for all 12 targets. `cargo clippy -p bun_install -p bun_runtime` is clean.

</details>
