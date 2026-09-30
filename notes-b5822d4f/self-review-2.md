# Design review: install: lockfile rows do not register npm: aliases

Head 04f38c0d8d on base a4f1429148. 17 files, +834/-70, of which source is +107/-67 in 12 files. The branch has no PR on GitHub yet, so "the body" below means the draft description.

## 1. Disposition

`merge-after-changes`: the premise holds and no better shape survived, so keep this PR and fix it before merge. Both failures reproduce on the shipped 1.4.3-canary.1+367d939d9 and on the base build, and the PR build installs the registry package in each.

Desirability verdict: `wanted` (confidence 0.68), pr_disposition `keep-open`. The result on a shipped build is a silently wrong package, the fix is small, and nothing merged or near merging fixes it where the unwanted write happens.

For a maintainer who has not read the diff:

- **The defect.** An `npm:` alias that bun has seen redirects a plain dependency of the same name to the alias target. Every lockfile loader registered the aliases of the rows it read into `PackageManager.known_npm_aliases`, which is never pruned. Entries outlived a lockfile that bun then discarded, and an override or catalog entry that package.json had dropped.
- **The change.** All 19 loader call sites stop passing a registry; the compiler enforces that for bun.lock and bun.lockb. For a kept binary-format lockfile (bun.lockb, and what package-lock.json and yarn.lock migrate to), a new pass registers the dependency rows again so kept results hold. It is `record_dependency_row_aliases` at `/workspace/bun/src/install/lockfile.rs:2172`; I call it the keep-site pass.

| Flow | canary 367d939d9 and base | PR build |
|---|---|---|
| Delete an `npm:` override, keep bun.lock, `bun install` | exit 0, "(no changes)", the fork stays installed and pinned, `--frozen-lockfile` then accepts it | "1 package installed", the registry package of that name |
| bun.lock rejected after its overrides ("Missing integrity", `warn: Ignoring lockfile`) | alias target installed under the plain name, exit 0; with an 18-byte target, exit 1 with `GET <registry>/ - 404` | the registry package, exit 0 |
| The PR's 17 new tests | 6 pass | 17 pass |

Across seven install test files the two builds differ only in those 17 tests. One 5 s timeout under a load average near 650 passed on every re-run.

No user reported this. That does not send it to close or supersede: the wrong package is silent, draft #36476 has been idle since 2026-08-04, and #43375 and #43515 are open without review.

**Required before merge** (from the four should-fix premise concerns):

1. Make the migrations enforce the rule instead of a hand-written `None`.
   - Narrow `Migrator.manager` and the `migrate_packages` parameter at `/workspace/bun/src/install/migration/npm_lock.rs:103` and `:122` to `&PackageManager`. The uses at `:136`, `:360` and `:556` only read.
   - I did not compile this. A review lane did, in a scratch copy: `cargo check` of `bun_install` passes with exactly those two lines changed (`/tmp/rowphase/check-npm.log`).
   - Add to `/workspace/bun/test/cli/install/migration/migrate.test.ts` a yarn.lock that bun reads and does not use. `bun add` with no root dependencies exits 1 with "Registry URL must be http:// or https://" on base and exits 0 on the PR build. No test covers it.
   - Guard the row sites of `/workspace/bun/src/install/yarn.rs` with a source lint or a test.
2. Close or state the `$name` override path through `OverrideMap::parse_append` at `npm_lock.rs:1028` and `yarn.rs:1989`. Retitle to "lockfile loaders do not register npm: aliases" and list the remaining writers.
3. Drop the claim that npm takes overrides from the manifest: npm 11.16.0 prints "up to date" and keeps a locked fork. List the deleted-override flip as a behaviour change and pin it with a test of that exact flow in `/workspace/bun/test/cli/install/bun-lock.test.ts`.
4. In the body:
   - Say that no user reported it and that it does not fix #23264.
   - Name #43375 (it has its own `known_npm_aliases.clear()` and rebuild), with one membership rule and the merge order.
   - Ask for #43515 first.
   - Add the `resolutions` and `pnpm.overrides` reader-gap scenarios with links to #38811 and #38754.

**Maintainer's call, not a blocker:** whether a kept bun.lockb keeps registering its dependency rows.

**Not verified:** the full suite, `rust:check-all`, a debug or ASAN build, and the `$name` case. The instruction counts and the 112-cell matrix are the launcher's numbers.

**What I ran while writing this:** the three scripts in `/tmp/disposition-probe/` (`probe.ts`, `npm-locked-fork.ts`, `yarn-unused.ts`) against the canary, base and PR binaries and npm 11.16.0. They gave the results in the table and in items 1 and 3. I also checked the file:line references against the tree at 04f38c0d8d. Anything attributed to a lane is that lane's measurement, not repeated by me.

## 2. Why

File references from here on use the file name; absolute paths are listed at the end.

**The two strongest arguments.**

> YES: "On main and on the shipped canary, deleting an `npm:` alias override from package.json leaves the alias target installed and pinned in bun.lock with exit 0 and no warning, nothing merged or close to merging corrects it, and this PR does."

> NO: "Open #43375 already clears known_npm_aliases and rebuilds it from reached rows of any lockfile format, so this PR's keep-site rule (every alias row of a binary-format lockfile, none of bun.lock) is a second, different answer to the same question that the PR body never mentions and that only a maintainer decision, the one draft #36476 reserves, can reconcile."

YES wins on severity: reach is low, but the wrong package is silent and the cost is small. The NO point is answered in the body and by merge order, not by a different fix.

**Real defect, no demand, and the body leads with the wrong trigger** (consider: existence, reach, tracker-history).
- Nobody filed either trigger; the report came from a work session. Twelve or more tracker phrasings return zero.
- Of the 15 issues that contain "Ignoring lockfile", none has ` - 404`, an `npm:` alias, or override or catalog content.
- The only reports with this error text are #23264 (open since 2025-10-05) and #28674 (closed as its duplicate). They describe a kept lockfile with an alias in another workspace, which is #43515's trigger.
- Only semver-versioned `npm:` aliases register. `Tag::infer` (dependency.rs:952-963) tags `npm:x@latest` as DistTag, and the only `record_npm_alias` call is in the Npm arm (dependency.rs:1183). Such aliases appear in 0 of 51 in-repo lockfiles and 0 of 18 sampled public override blocks.
- The body leads with the rarest trigger. "Ignoring lockfile" plus a 404 needs three things at once: a load failure after the alias rows, a package.json that dropped the alias, and a same-name plain dependency in range. The flow an ordinary edit reaches is second and has no test in that shape.
- Lead with the deleted-override flow and its output on main. Put the silent rejected-lockfile case second: a bun.lock or package-lock.json rejected by the off-registry integrity rule still installs the lockfile's alias target under the plain name with exit 0. It then writes a new bun.lock that pins it.
- That contradicts the contract written at bun-lockb.test.ts:522-525 and migrate.test.ts:288; cite both.
- Do not call it a security fix. A lockfile row that bun accepts installs the same package on both builds, `--frozen-lockfile` included.
- Use no "Fixes #".

**The rule is a type for two loaders and a hand-written `None` for the rest** (should-fix: bigger-shape, three lanes).
- Compiler-enforced after the PR:
  - The bun.lock loader takes `Option<&PackageManager>` (bun.lock.rs:1847).
  - `dependency::Context` has no registry field (dependency.rs:308-312).
  - `put_lockfile_rule` has no manager parameter (OverrideMap.rs:517-524).
  - `process_deps` lost its manager (yarn.rs:528).
- Convention only: the migrations still hold `&mut PackageManager` (yarn.rs:617, pnpm.rs:479, npm_lock.rs:103), and `parse` still accepts one (dependency.rs:1073-1080).
- Seven live sites pass `None` by hand: yarn.rs:1170, 1635, 1707, 1759, 1811, 1863 and npm_lock.rs:680. (npm_lock.rs:595 parses with `DepTag::Github` and cannot register.)
- This is already in motion. Open #43103 adds a row parse with `Some(&mut *self.manager)` to npm_lock.rs. Merged onto this tree it compiles (`/tmp/rowphase/check-merge-unnarrowed.log`, exit 0), and package-lock.json rows register again. One npm test stands in the way.
- With the two-line narrowing, that line fails with E0596 (`/tmp/rowphase/check-npm-43103.log`).
- For yarn nothing stands in the way. The four row blocks at yarn.rs:1694-1899 revert to main with all 17 tests green.
- The PR rejects `clear()` at the reset sites because every future reset site would have to carry the call. The same argument applies to every future row parse carrying `None`.
- The lane's lint is about 40 lines, in the form of `/workspace/bun/test/internal/source-lints/node-vm-option-names.test.ts`. It scans yarn.rs, pnpm.rs and npm_lock.rs, requires the last argument of every parse-family call to be `None`, and asserts it saw more than 10 calls. It has 0 hits today.
- The yarn and pnpm row-phase split that would make those files type-enforced (+74/-28, type-checked by the lane) is a follow-up. Say so in the body.

**The title claims the class; the diff fixes the loaders** (should-fix and consider: bigger-shape).
- The map has one reader (PackageManagerEnqueue.rs:803) and one write (dependency.rs:1183), reached from 43 direct call sites. After the PR, 24 pass `None` and 19 still pass a live registry (31 before). The map is still never pruned.
- One remaining site still carries a lockfile row into the map. The migrations parse root overrides through `parse_append` with the manager (npm_lock.rs:1028, yarn.rs:1989), and a `$name` value reads the root row of the migrated lockfile.
- The lane reports that on the PR build a package-lock.json project still resolves a new plain dependency to an alias target that only the lockfile's root row names. bun.lock, bun.lockb and no lockfile give the registry package.
- The keep-site pass re-registers every alias row of a kept bun.lockb or package-lock.json (lockfile.rs:2172, called at install_with_manager.rs:164). A dropped alias dependency row therefore still installs the alias target with exit 0.
- Inside one bun.lockb, an override or catalog row and a dependency row now give different answers. yarn.lock takes the same path; nobody ran it.
- A gdb trace on the PR build shows 300 writes for 100 root alias rows in a bun.lockb: 100 from the pass, 100 from `parse_dependency` (Package.rs:1787), 100 from `clean_with_logger` through `Package::clone` (Package.rs:575).
- A kept bun.lock with one transitive alias row gets 1 write, from `clean_with_logger`. So a bun.lock row does reach the map, after resolution.
- Retitle, correct the first Fix bullet and the three test comments, and list the remaining writers and the intentionally excluded sites (REVIEW.md:33).
- Give `parse_append` a way to not register and use it at the two migration sites, with a package-lock.json `$name` test in migrate.test.ts. The package.json parse that follows (install_with_manager.rs:187 or :1948) registers the flat overrides.
- Do not fold the class fix (explicit registration, about 52 call sites) into this PR. Five open PRs edit the same lines.

**The npm claim is false where it matters, and one kept-bun.lock result flips** (should-fix: existence).
- Never-bound flow, which is what the PR's tests pin: the lockfile lists the alias row, nothing is bound under that name, and package.json drops the row and adds a plain dependency. npm 11.16.0, pnpm 10.34.6, pnpm 12.8.1, yarn 1.22.22, yarn 4.18.1 and the PR build install the registry package. Only main installs the alias target.
- Locked-fork flow: override `kept: npm:short@1.0.0`, a parent depends on `kept@^1.0.0`, install, delete the override, keep the lockfile, install.
  - npm 11.16.0 prints "up to date" with 0 manifest requests and keeps the fork. So do yarn 1, pnpm 9 and 10, and main.
  - pnpm 11 and 12, yarn 4 and the PR replace it.
  - With the fork's version outside the dependent's range, all replace it.
- A reviewer who runs the check that "npm and pnpm take overrides from the manifest" names sees the opposite (landing-prs.md:55). The case rests on bun's own override rule.
- Replace the sentence with the measured split. On every released bun this edit prints "no changes", so the flip goes under behaviour changes (landing-prs.md:64) with a test.

**Three other changes touch the same map and the body names none** (consider: already-planned, bigger-shape).
- Nothing makes this PR moot. `git grep 'known_npm_aliases.(clear|remove|retain|drain)'` returns nothing on origin/main or the PR head, and the PR merges cleanly onto current main (9f70da0741).
- #43375 is open and blocked (+1151/-91, 70 review comments, head 4259d4175a). At install_with_manager.rs:1840-1843 in its tree it clears the map and rebuilds it from the reached rows of any lockfile format, under a comment that names this defect.
- If both land as written, that file holds two answers to "which rows of a kept lockfile are known aliases" (REVIEW.md:64). This PR's doc comment "and not of bun.lock" is then false in #43375's waves.
- #43515 changes the map's value to text. It is smaller, it has the two user reports, and it already delivers the yarn.lock result change. Ask for it first.
- Whichever lands second replaces the `parse_with_tag` call in `record_npm_aliases` (lockfile.rs:2097) with `registry.record_npm_alias(row.name_hash, row.version.literal.slice(buf))`.
- The 14 clone sites stay alias writers until #43515 stores text. Dropping the clone parameter is a follow-up.
- Draft #36476 deletes the map. It is conflicting and idle since 2026-08-04, and dylan-conway merged alias fix #33835 on the current resolver with that draft open. Do not wait for it.

**The oracle is "package.json as bun's parser reads it", and that parser skips three places where users still declare overrides** (consider: bigger-shape).
- `parse_count` and `parse_append` read `overrides`, else `resolutions` (OverrideMap.rs:590-596, 661-667). An empty `"overrides": {}` already shadows `resolutions`.
- `pnpm.overrides` in package.json (pnpm.rs:2368-2397) and the overrides of pnpm-workspace.yaml (pnpm.rs:2553, 2675-2700) are read only inside `update_package_json_after_migration`. Its one call is pnpm.rs:1624, after the last fallible step.
- The lane ran four scenarios that change package with exit 0 and no line naming the override. Two of them:
  - A failed pnpm migration with the alias declared in `pnpm.overrides` goes from `override-of-short -> short@1.0.0` on base to `override-of-short@1.0.0` on the PR.
  - With a target over 8 bytes it goes from exit 1 to a saved bun.lock without the override. bun does not retry the pnpm migration once bun.lock exists.
- The reader gap belongs to open #38811 and #38754. Keep the code.
- Add a Downsides bullet with the four scenarios, qualify the matrix sentence (no pnpm-lock.yaml column, no `resolutions` row), and link both PRs.

**The keep-site pass serves legacy formats only** (consider: existence).
- The install site is gated on `ok.format == Format::Binary` (install_with_manager.rs:164-167). The runtime site is gated on `has_lockb` (PackageManager.rs:2678-2692).
- `Format::Binary` comes from bun.lockb (lockfile.rs:721), the npm migration (migration.rs:419) and the yarn migration (yarn.rs:1927). pnpm reports Text (pnpm.rs:1630).
- `save_format` (lockfile.rs:420-437) writes bun.lock after a migration unless `saveTextLockfile=false`, so a migrated project gets the pass for one install.
- About 2% of active public Bun repos still carry bun.lockb (GitHub sample of 2026-09-29). No report, prior test or real lockfile the lane tried depends on the pass.
- Put the population in the body and ask the install maintainer (dylan-conway, #36476) to pick one:
  - Keep it as a stated legacy-format shim. Name the tests as legacy behaviour, and drop or relabel the two migration tests, which pin a one-invocation window.
  - Delete `record_dependency_row_aliases`, the two `Format::Binary` gates and their tests, so that no lockfile row registers.

## 3. If it proceeds anyway: execution concerns

These do not change the disposition. The should-fix items are expected before merge. Two of the tests asked for here are the same tests the required list asks for.

### Should-fix

**3.1 The keep-site pass is not a replay of main, and the description says it is** (alternative, edge-cases, wrong-layer; five lanes).

Pushback: the commit message says "a kept lockfile resolves as before" and the body says "resolves as on main". Neither is true. `record_npm_aliases` reads rows after the loader changed them, so kept bun.lockb and package-lock.json results move on valid input. None is listed and none has a test. The body's reasons for rejecting the two alternatives do not hold either.

Evidence:
- The pass is lockfile.rs:2087-2107. It skips rows with `tag != Npm || !is_alias` (:2093) and re-parses the untrimmed literal (:2096-2105). It runs after the load. Main registered inside `parse_with_tag` at parse time (dependency.rs:1181-1185).
- Workspace-linked target:
  - Every loader ends with `tag_workspace_links` (lockfile.rs:715, migration.rs:405, yarn.rs:1908). It rewrites an Npm row whose resolution is a workspace to `Tag::Workspace` (lockfile.rs:2237-2244), and the pass skips it.
  - Case: a bun.lockb where a registry package declares `kept: npm:short@1.0.0` and `short` is also a workspace at 1.0.0, then `bun add new-dependency` with a plain `kept@^1.0.0`.
  - Base adds nothing and requests only /new-dependency.
  - The PR adds `new-dependency/kept: kept@1.0.0` and requests /kept. When the registry has no `kept` it exits 1 with `GET <registry>/kept - 404`.
  - With `linkWorkspacePackages = false` the builds agree.
- Untrimmed literal: `Dependency::parse` trims (dependency.rs:1081) and stores the untrimmed literal (:1170). For a package-lock.json row `"kept": " npm:short@1.0.0"` the pass's `starts_with(b"npm:")` (:1131) is false. Base follows the alias; the PR does not.
- Dropped rows, by the code: the npm migration parses a row (npm_lock.rs:680) and then drops it as a peer duplicate (:718-720) or as "could not find package" (:747-754). Main had registered it; the pass never sees it.
- "(each load pays)", the body's reason against keeping aliases in the load result, has no number. Measured, it is about 25 to 38 instructions per alias row.
- "misses the kept lockfile" is the body's reason against `clear()` at the two reset sites (install_with_manager.rs:1920, PackageManager.rs:2693). One more call at the keep point, forgetting the lockfile's override and catalog aliases, closes that. The lane simulated it under gdb on the base debug build and did not build it.

Fix: decide, and write the decision in the body. Keep the pass.
1. Trim in `record_npm_aliases` (`strings::trim_left(literal.slice, b" \t\n\r")`). That restores the package-lock.json result. It is safe for bun.lockb, whose rows with leading whitespace have `is_alias` false.
2. Accept the workspace-linked and dropped-row changes and list them. Main followed the workspace-linked alias only until bun.lockb was saved again, and bun.lock never did.
   - Replace both "resolves as" sentences and add both changes to Downsides.
   - Say at lockfile.rs:2167 that a row the loader linked to a workspace is not registered.
   - Pin the workspace case in bun-lockb.test.ts next to the test at :619.
3. Do not make the pass accept `Tag::Workspace` rows, and do not move to a parse-time, load-local registry. One lane ran the premises of both on both builds. The first moves two cases where main and the PR agree today. The second brings back the yarn garbage-name failure and the stale entry across the text round trip.
4. Replace the two rejected-alternative sentences with reasons that hold: type enforcement at the bun.lock and bun.lockb loaders, and no call that every future reset site must carry.

If no kept result may move at all, the candidate is a `(name_hash, literal)` list captured where the loader parses: Buffers.rs:468, npm_lock.rs:680 and the five yarn.rs second-phase sites. It is committed at the two keep sites with `parse_with_tag` on the trimmed literal. It is unbuilt and needs its own run on both builds first.

**3.2 A third unlisted bun.lockb change: a top-level ranged override** (edge-cases).

Pushback: the change is wider than "an override for one parent". A rule such as `"kept@2": "npm:short@1.0.0"` also stops redirecting for `bun add`, `bun update` and runtime auto-install. It is not in the 112-cell matrix, Downsides or the commit message, and no test pins it.

Evidence:
- A rule with no parent but a target range is not flat and goes to `overrides.scoped` (OverrideMap.rs:899-918, same rule at :550). bun.lockb writes every scoped rule (bun.lockb.rs:347-376).
- origin/main parsed all three columns with the manager (bun.lockb.rs:792-816 there), so the dep column registered `kept`.
- On the branch nothing registers it:
  - The loader has no registry (bun.lockb.rs:801-812).
  - `record_dependency_row_aliases` reads only `buffers.dependencies` (lockfile.rs:2172-2178).
  - `record_override_and_catalog_aliases` reads only `overrides.map` and the catalogs (lockfile.rs:2183-2193).
  - package.json registers only when `is_flat` (OverrideMap.rs:899-900).

Fix: make the test at bun-lockb.test.ts:619 an `it.each` over the scoped rule shapes:
- `{ parent: aliases }`, `{ "<name>@2": "npm:<target>@1.0.0" }` and `{ parent: { "<name>@2": ... } }`, with the registry also serving 2.0.0 of each name.
- Assert that new-dependency's plain `^1.0.0` edge locks the registry package and requests `/<name>`. The ranged row fails on main and passes on the branch.
- Name the row class in Downsides and in the commit message.

**3.3 "Still wrong" has no tracking issue, and it is the PR's own class** (convention).

Pushback: the body ships "Still wrong: a kept bun.lockb registers the alias row of a package that the install removes" with no link. That residual is the headline class, the new pass writes it, and it is wider than the bullet says.

Evidence:
- landing-prs.md:68: "'out of scope' without a tracker is not accepted. Exception: if it's the exact bug class your PR claims to eliminate, fix all instances in the same PR". REVIEW.md:33: "If a site is intentionally excluded, say so in the PR."
- The diff has no issue link and no `test.todo`. A tracker search for `known_npm_aliases` returns only closed #28674 and #33834.
- The residual covers bun.lockb, package-lock.json and yarn.lock. It covers any alias row package.json no longer reaches, including the root's own dropped row.
- The wrong binding is written to the saved lockfile, and `--frozen-lockfile` accepts it.

Fix: file the issue before opening the PR, in the shape of #43568.
- Include the lane's repros, and the results for bun.lock and no lockfile against the three binary-format sources.
- Include the npm 11.16.0 result and the `--frozen-lockfile` consequence.
- Add a "Decision needed" section: npm's name-blind binding, or the fresh-install result.
- Link it from the bullet, cross-link #36476, #43375 and #41774, and make the bullet name all three formats.

This is the same decision section 2 leaves to the install maintainer.

**3.4 The yarn.rs edits have no test that fails without them** (coverage-gap, two lanes).

Pushback: yarn.lock is counted among the fixed loaders, but the 7 edited sites in yarn.rs can be reverted to main with all 17 tests green. After #43515 lands, "Verified: 17 tests (11 fail on main)" is off by one.

| Tree | New tests failing |
|---|---|
| main a4f1429148 | 11 of 17 |
| main + #43515 (4d933f1bfd) | 10 of 17 |
| PR 04f38c0d8d, with or without #43515 | 0 |
| PR with yarn.rs reverted to main, with or without #43515 | 0 |

Evidence:
- The test that flips is the kept-lockfile `yarn.lock` test at migrate.test.ts:2063. With yarn.rs reverted it still passes, because the keep-site pass overwrites what the yarn sites registered.
- The place where a yarn.lock's alias rows outlive the lockfile is silent. The root package.json has no dependencies, and stderr prints `migrated lockfile from yarn.lock`, not `warn: Ignoring lockfile`. A root with only `workspaces` is a common yarn v1 monorepo shape.
- The failure point that would print the warning gives nothing to test. `parse_root_overrides(...)?` at yarn.rs:1682 runs before any yarn.lock row is parsed, and its error aborts the fallback resolve identically on both builds.
- I re-ran the silent case. Canary and base exit 1 with `error: Registry URL must be http:// or https://` and `dependency-of-some-other-package@^1.0.0 failed to resolve`. The PR build exits 0 and locks each name as its own package.

Fix: add the "read, then not used" yarn.lock test to migrate.test.ts beside :1980 and :2004, mirroring bun-lock.test.ts:1896.
- Setup: package.json `{name:"app"}`, the yarn.lock text of the test at :2063, `add new-dependency`.
- Expect stderr to contain `migrated lockfile from yarn.lock` and no `error:`.
- Expect packages `{...ownPackages(aliases), "new-dependency": "new-dependency@1.0.0"}`.
- Expect requests `manifestsOf("new-dependency", "short", "some-other-package", ...Object.keys(aliases))` and exit 0.
- Run it for rows under dependencies, optionalDependencies, peerDependencies and devDependencies, so each of yarn.rs:1707, 1759, 1811 and 1863 has a killing test.
- Restate the verified count for the landing order with #43515 first.

**3.5 The deleted-override flip has no full-install test** (coverage-gap).

Pushback: the one kept-lockfile change users will see is untested. Every new install-flow helper passes `--lockfile-only`, and the "package.json no longer has the rows" tests use rows that were never applied.

Evidence:
- The helpers append `--lockfile-only` at bun-lock.test.ts:1866, bun-lockb.test.ts:546 and migrate.test.ts:1942. That flag returns at install_with_manager.rs:847-858, before either linker runs.
- The tests at bun-lock.test.ts:1906 and bun-lockb.test.ts:594 start with only `unrelated` bound, so no existing binding flips.
- In my re-run of the flow, canary and base print "(no changes)" and keep `short` installed as `kept`. The PR build prints "1 package installed" and installs `kept`.

Fix: add the test as a full install in the new describe blocks of bun-lock.test.ts and bun-lockb.test.ts, reusing `aliasRegistry`, which already serves tarballs.
- Setup: `dependencies: plainDependencies(rows)` and `overrides: rows`, then `bun install`. Assert the precondition that `node_modules/<name>/package.json` carries the alias target's name.
- Flip: rewrite package.json without `overrides`, then `bun install`. Assert that the installed `name` equals `<name>` and that `lockedPackages` equals `ownPackages(rows)`.
- Include an applied catalog alias and state what it does. The never-applied tests do not show it.

**3.6 Three load-bearing clauses survive mutation** (coverage-gap).

Pushback: REVIEW.md:10 says to confirm that deleting each load-bearing clause breaks at least one test. Three clauses can be moved or deleted with all 17 tests and ten related test files green. One mutant brings back the exact error in the Problem section.

Evidence (the lane ran each mutant, linked against the PR's release objects):
- The install-site call moved above `if needs_new_lockfile { break 'differ }` (install_with_manager.rs:160-167). The only Ok-load tests that take the break are the `it.each` at bun-lock.test.ts:1896. They are Text format, so the Binary-gated pass never runs.
- The `format == Binary` gate at the runtime site (PackageManager.rs:2685-2688).
- The registry removal at five loader sites: bun.lock's grouped "." override, and the four yarn.lock row groups.

Fix:
- The yarn test of 3.4 kills the placement mutant and the yarn rows.
- Add one override in the grouped form `{ name: { ".": "npm:...", child: "1.0.0" } }` (lockfileVersion 3) to the rows of the dropped-rows test in bun-lock.test.ts.
- For the runtime gate, add a test that fails without it or delete the gate.

**3.7 The yarn garbage name is fixed for one consumer only** (wrong-layer).

Pushback: the yarn defect is not in `process_deps`. It is the `SlicedString::init(literal, literal)` parse at the five second-phase sites. The PR edits those calls and leaves the base wrong. The pass corrects the registered alias, but the row's own target name stays garbage.

Evidence:
- yarn.rs:1630, 1702, 1754, 1806 and 1858 build the slice with the literal as its own buffer. Lines 1645, 1717, 1769, 1821 and 1873 repair only `.literal`.
- The parser takes the name as `sliced.sub(..).value()` (dependency.rs:1139, 1146). The pointer stores an offset relative to that buffer (semver/lib.rs:764-771), not to `string_bytes`.
- `process_deps` strips `npm:<name>@` before parsing (yarn.rs:558-563), so its rows were never aliases. Those rows are orphaned at yarn.rs:1673-1680 and 1901-1905.
- The pass discards the re-parsed Version (`let _ =`, lockfile.rs:2097). The row's own name is still read by `realname()` (dependency.rs:237-246), by PackageManagerEnqueue.rs:783-792, by install_with_manager.rs:1612-1620, and by update_transitive.rs:1105-1112.
- Measured on the PR build, in a yarn project with a transitive alias to a target over 8 bytes:
  - `bun update <alias or target>` as the first command gives `GET <registry>/<garbage> - 404`, exit 1.
  - Bare `bun update` silently leaves that alias at its old version.

Fix:
- At the five sites build the slice as `dep_version_string.sliced(this.buffers.string_bytes.as_slice())`, as yarn.rs:1174 and npm_lock.rs:679 do. The five `.literal =` lines are then redundant.
- Add a test beside the yarn.lock test: `bun update dependency-of-some-other-package --lockfile-only` directly on the yarn.lock project, expecting exit 0 and a request for /some-other-package.

### Consider

**3.8 Two new comments say the runtime parses no package.json for aliases** (assumption).

Pushback: it does. The resolver registers the dependency aliases of every package.json it loads after the package manager is wired, and that write replaces the init pass's entry.

Evidence:
- The comments are at lockfile.rs:2180-2181 and run-autoinstall.test.ts:133-135.
- resolver.rs:6346-6358 calls `parse_package_json::<true>` for a directory without node_modules. package_json.rs:894-909 calls `pm.parse_dependency`. auto_installer.rs:409 passes `Some(self)`, which reaches the overwriting insert at dependency.rs:25-27.
- Behaviour is identical on both builds. The kept-lockfile runtime test passes for the 18-byte target only because its single package.json is parsed before the manager exists.
- landing-prs.md:53: "A comment contradicting the code is a correctness bug, not a nit".

Fix: no code change. Both comments should say the runtime reads no overrides or catalogs from package.json. The test comment should add that the root package.json is parsed before the manager exists, and that the resolver registers the dependency aliases of any package.json it loads after the first auto-install. Name the residual in the body.

**3.9 A `resolutions` alias shadowed by an `overrides` key** (edge-cases).

Pushback: adding any `overrides` key next to a `resolutions` alias now swaps the fork for the registry package on a kept bun.lock or bun.lockb, with exit 0 and no warning. The body does not list it.

Evidence:
- Setup: `resolutions {kept: "npm:short@1.0.0"}` with a parent that wants `kept@^1.0.0`; install; add `overrides {unrelated: "1.0.0"}`; install.
- Base keeps `short@1.0.0` and prints "(no changes)".
- The PR installs `kept@1.0.0` and prints "1 package installed". A following `--frozen-lockfile` install passes.
- The same happens with bun.lockb, with the 18-byte name, and with an empty `"overrides": {}`.
- The cause is the overrides-else-resolutions rule (OverrideMap.rs:590-596, 661-667) together with the override invalidation at install_with_manager.rs:339-348 and 507-529.

Fix: add one Downsides line and name #38811 (and the fold #39403) as the owner of the shadowing. Add no warning and no test.

## 4. What was checked and held up

53 concerns were dismissed. The ones that bear on the shape:

- **Fold into or sequence behind #43375** (one membership rule now; repackage the cluster): refuted 4/4 each. This PR adds no new first-wave rule, the costs named are not caused by it, and nothing breaks in either merge order.
- **Cost of building and keeping the pass:** refuted 4/4. The structural facts are right; the cost and risk drawn from them are overstated.
- **Move the alias map into the lockfile; residue of a discarded load; Node or spec compatibility:** probed on both builds, none applies. No WHATWG or WinterCG spec covers this, and Node has no package-manager behaviour of its own.
- **Other shapes for the keep-site pass:** refuted 2/2 or probed as not applying.
  - The shapes were: skip local rows, run the pass only when resolving, drop the runtime override half, ungate it for all formats, loaders take options, a one-shot migration, and validating the plain-edge binding at load.
  - There is no third keep site: the map has one reader, PackageManagerEnqueue.rs:803.
  - A second reader in #43981 belongs to that PR.
- **Gates and hygiene:** the lint-gate and suite-rerun concerns did not apply. Clippy and the source lints were run at 04f38c0d8d with the workflow commands, and the related suites were re-run on the final diff. The style findings were refuted as nits or as pre-existing.
- **Not clean wins:** two bigger-shape alternatives (fix at a better level; land the text-format half first as a split) were dropped on 2/4 votes. The visible skeptic notes say the facts held. Treat them as open questions for the maintainer.

## Paths

- `/workspace/bun/src/install/`: `dependency.rs`, `lockfile.rs`, `migration.rs`, `yarn.rs`, `pnpm.rs`, `PackageManager.rs`, `auto_installer.rs`, `update_transitive.rs`
- `/workspace/bun/src/install/lockfile/`: `OverrideMap.rs`, `Buffers.rs`, `Package.rs`, `bun.lock.rs`, `bun.lockb.rs`
- `/workspace/bun/src/install/migration/npm_lock.rs`
- `/workspace/bun/src/install/PackageManager/`: `install_with_manager.rs`, `PackageManagerEnqueue.rs`
- `/workspace/bun/src/resolver/`: `resolver.rs`, `package_json.rs`
- `/workspace/bun/src/semver/lib.rs`
- `/workspace/bun/test/cli/install/`: `bun-lock.test.ts`, `bun-lockb.test.ts`, `migration/migrate.test.ts`
- `/workspace/bun/test/cli/run/run-autoinstall.test.ts`
- `/workspace/bun/REVIEW.md`, `/workspace/bun/.claude/docs/landing-prs.md`
- Probes: `/tmp/disposition-probe/` (scripts and saved test output), `/tmp/rowphase/` (the lane's `cargo check` logs)