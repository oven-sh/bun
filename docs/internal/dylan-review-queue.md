# robobun PRs matched to dylan-conway's commit history

Generated from 1775 open robobun PRs in oven-sh/bun and 83 in oven-sh/WebKit.

**Method:** each PR's changed files scored against dylan-conway's per-file commit count (2307 bun commits, 174 WebKit commits). `cov` = fraction of the PR's src files dylan has committed to at least once. Grouped by area, sorted by match confidence.

---

## Quick picks (highest confidence, smallest review effort)

- **ci-build** [#34681](https://github.com/oven-sh/bun/pull/34681) `+6/-1` — ci: bump darwin test-bun parallelism 2 -> 5
- **ci-build** [#31873](https://github.com/oven-sh/bun/pull/31873) `+23/-8` — ci: mirror Intel SDE on CI asset host and fail fast on a bad baseline download
- **install** [#34979](https://github.com/oven-sh/bun/pull/34979) `+35/-0` — install: honor `[install] dryRun` from bunfig.toml
- **ci-build** [#34480](https://github.com/oven-sh/bun/pull/34480) `+40/-1` — ci: wait for dockerd before launching the test-service coordinator on Linux agents
- **ci-build** [#35328](https://github.com/oven-sh/bun/pull/35328) `+45/-18` — ci: link PR builds with the base branch symbol order file
- **yaml** [#34887](https://github.com/oven-sh/bun/pull/34887) `+52/-3` — yaml: own the property-name anchor string so it survives GC during stringify
- **ci-build** [#32512](https://github.com/oven-sh/bun/pull/32512) `+64/-2` — build: reject prebuilt baseline macOS builds (no Nehalem macOS WebKit)
- **yaml** [#34851](https://github.com/oven-sh/bun/pull/34851) `+80/-31` — yaml: keep signed hex/octal as strings, fold CRLF as one break in quoted scalars, preserve merge-key source order
- **install** [#36303](https://github.com/oven-sh/bun/pull/36303) `+83/-7` — install: merge dev/prod duplicate in workspace hoist so --frozen-lockfile is stable
- **yaml** [#32385](https://github.com/oven-sh/bun/pull/32385) `+91/-24` — yaml: fold merge-key property budget into alias-expansion budget
- **install** [#30076](https://github.com/oven-sh/bun/pull/30076) `+107/-2` — install: consider OR'd alternatives in find_best_version fast path
- **install** [#33835](https://github.com/oven-sh/bun/pull/33835) `+121/-16` — install: do not redirect an npm: alias dependency to a same-named alias
- **install** [#32634](https://github.com/oven-sh/bun/pull/32634) `+131/-32` — install: name cache directory when its .tmp fallback fails
- **install** [#34651](https://github.com/oven-sh/bun/pull/34651) `+167/-23` — install: don't debug_assert on untrusted registry packument version keys
- **ci-build** [#34877](https://github.com/oven-sh/bun/pull/34877) `+184/-50` — ci(verify-baseline): parse //@ JSC flags, skip v128 wasm fixtures on x64, re-enable --jit-stress on WebKit changes
- **install** [#29726](https://github.com/oven-sh/bun/pull/29726) `+232/-13` — install: honor process umask when creating directories
- **install** [#33194](https://github.com/oven-sh/bun/pull/33194) `+280/-22` — install: resolve overrides that point at a tarball with a mismatched internal name
- **install** [#33156](https://github.com/oven-sh/bun/pull/33156) `+383/-20` — install: resolve peers provided by file: dependencies and stop writing duplicate package paths
- **yaml** [#34855](https://github.com/oven-sh/bun/pull/34855) `+428/-48` — yaml: resolve self-referential anchors so cyclic objects round-trip
- **windows** [#34766](https://github.com/oven-sh/bun/pull/34766) `+96/-22` — windows: update the per-drive cwd env var in process.chdir
- **install** [#33972](https://github.com/oven-sh/bun/pull/33972) `+4/-1` — test(install): mark "peer *" hoisting case todoIf(isFlaky)
- **install** [#36300](https://github.com/oven-sh/bun/pull/36300) `+86/-4` — install: keep peer-dependent packages next to the peer version they resolved against
- **install** [#36298](https://github.com/oven-sh/bun/pull/36298) `+130/-4` — install(hoisted): defer nested skip until parent tree is installed
- **install** [#34336](https://github.com/oven-sh/bun/pull/34336) `+149/-31` — install: dedupe a transitive wide range onto a root/workspace range across majors
- **install** [#35571](https://github.com/oven-sh/bun/pull/35571) `+152/-0` — install: hoist workspace members in path order, not package-name order
- **install** [#33632](https://github.com/oven-sh/bun/pull/33632) `+319/-18` — install: fail --frozen-lockfile when a workspace's package.json dependency map diverges from bun.lock
- **install** [#32304](https://github.com/oven-sh/bun/pull/32304) `+66/-10` — install: preserve non-ASCII UTF-8 bytes in isolated store path names
- **install** [#30451](https://github.com/oven-sh/bun/pull/30451) `+104/-2` — install(isolated): link bins of -g update requests into $BUN_INSTALL/bin
- **ci-build** [#35478](https://github.com/oven-sh/bun/pull/35478) `+1/-1` — Object.seal/freeze: take the JSObject fast path for arrays and indexed objects
- **install** [#35035](https://github.com/oven-sh/bun/pull/35035) `+11/-25` — test(install): deflake SCP-style git URL test in bun-add.test.ts
- **ci-build** [#34277](https://github.com/oven-sh/bun/pull/34277) `+25/-1` — Fix AsyncLocalStorage context loss in thenables returned from async functions
- **ci-build** [#34762](https://github.com/oven-sh/bun/pull/34762) `+32/-2` — Intl.Collator: throw RangeError instead of aborting on a 2^30-byte Latin-1 operand
- **ci-build** [#33248](https://github.com/oven-sh/bun/pull/33248) `+35/-0` — build: disable clang-cl's default stack buffer security check on Windows release (/GS-)
- **ci-build** [#36361](https://github.com/oven-sh/bun/pull/36361) `+38/-1` — Bump WebKit: omit dayPeriod from Intl.DateTimeFormat resolvedOptions for bare 12-hour patterns
- **ci-build** [#36262](https://github.com/oven-sh/bun/pull/36262) `+38/-1` — jsc: don't leak builtin @-identifiers in TypeError messages (debug/ASAN)
- **ci-build** [#36195](https://github.com/oven-sh/bun/pull/36195) `+38/-1` — Intl.Collator: honor locale-tailored caseFirst default (da, mt)
- **ci-build** [#35938](https://github.com/oven-sh/bun/pull/35938) `+39/-1` — jsc: avoid quadratic basic block linking and liveness for deeply nested array destructuring
- **ci-build** [#36362](https://github.com/oven-sh/bun/pull/36362) `+41/-1` — Intl.NumberFormat: fix percent formatRange scaling twice on approximately path
- **ci-build** [#36321](https://github.com/oven-sh/bun/pull/36321) `+43/-1` — ShadowRealm: cache importValue module in its own realm under require(esm)
- **ci-build** [#34339](https://github.com/oven-sh/bun/pull/34339) `+46/-1` — jsc: throw RangeError for deeply nested object/array literals instead of hanging

---

## oven-sh/bun

### install — package manager, lockfile, bun add/update/pm/pack/publish, bunx, semver
_core ownership · 210 PRs total, 204 above threshold_

- [#36303](https://github.com/oven-sh/bun/pull/36303) `+83/-7` cov=100% — install: merge dev/prod duplicate in workspace hoist so --frozen-lockfile is stable
- [#34979](https://github.com/oven-sh/bun/pull/34979) `+35/-0` cov=100% — install: honor `[install] dryRun` from bunfig.toml _(also: toml)_
- [#34651](https://github.com/oven-sh/bun/pull/34651) `+167/-23` cov=100% — install: don't debug_assert on untrusted registry packument version keys
- [#33835](https://github.com/oven-sh/bun/pull/33835) `+121/-16` cov=100% — install: do not redirect an npm: alias dependency to a same-named alias
- [#33194](https://github.com/oven-sh/bun/pull/33194) `+280/-22` cov=100% — install: resolve overrides that point at a tarball with a mismatched internal name
- [#33156](https://github.com/oven-sh/bun/pull/33156) `+383/-20` cov=100% — install: resolve peers provided by file: dependencies and stop writing duplicate package paths
- [#32634](https://github.com/oven-sh/bun/pull/32634) `+131/-32` cov=100% — install: name cache directory when its .tmp fallback fails
- [#30076](https://github.com/oven-sh/bun/pull/30076) `+107/-2` cov=100% — install: consider OR'd alternatives in find_best_version fast path
- [#29726](https://github.com/oven-sh/bun/pull/29726) `+232/-13` cov=100% — install: honor process umask when creating directories _(also: sys)_
- [#35110](https://github.com/oven-sh/bun/pull/35110) `+683/-127` cov=86% — install(hoisted): gate workspace .bin links on trust to stop transitive bin shadowing
- [#33106](https://github.com/oven-sh/bun/pull/33106) `+308/-101` cov=86% — install: only constrain transitive file: targets of remote packages
- [#36300](https://github.com/oven-sh/bun/pull/36300) `+86/-4` cov=100% — install: keep peer-dependent packages next to the peer version they resolved against
- [#36298](https://github.com/oven-sh/bun/pull/36298) `+130/-4` cov=100% — install(hoisted): defer nested skip until parent tree is installed
- [#36219](https://github.com/oven-sh/bun/pull/36219) `+1277/-166` cov=80% — install: propagate `[install.cache] disable = true` to the manifest cache
- [#35571](https://github.com/oven-sh/bun/pull/35571) `+152/-0` cov=100% — install: hoist workspace members in path order, not package-name order
- [#34336](https://github.com/oven-sh/bun/pull/34336) `+149/-31` cov=100% — install: dedupe a transitive wide range onto a root/workspace range across majors
- [#33972](https://github.com/oven-sh/bun/pull/33972) `+4/-1` cov=100% — test(install): mark "peer *" hoisting case todoIf(isFlaky)
- [#33632](https://github.com/oven-sh/bun/pull/33632) `+319/-18` cov=100% — install: fail --frozen-lockfile when a workspace's package.json dependency map diverges from bun.lock
- [#32974](https://github.com/oven-sh/bun/pull/32974) `+844/-56` cov=100% — install: remove node_modules entries that left the lockfile
- [#35105](https://github.com/oven-sh/bun/pull/35105) `+395/-63` cov=82% — install: refuse untrusted extraction cache and make --force re-verify _(also: sys)_
- [#33979](https://github.com/oven-sh/bun/pull/33979) `+409/-38` cov=80% — install: don't leak package extraction temp directories into $TMPDIR _(also: sys)_
- [#32304](https://github.com/oven-sh/bun/pull/32304) `+66/-10` cov=100% — install: preserve non-ASCII UTF-8 bytes in isolated store path names
- [#30451](https://github.com/oven-sh/bun/pull/30451) `+104/-2` cov=100% — install(isolated): link bins of -g update requests into $BUN_INSTALL/bin
- [#36284](https://github.com/oven-sh/bun/pull/36284) `+243/-6` cov=100% — install: move existing dependency when `bun add` is given an explicit group flag
- [#35468](https://github.com/oven-sh/bun/pull/35468) `+250/-234` cov=100% — install: link workspace packages for dist-tag dependencies
- [#35454](https://github.com/oven-sh/bun/pull/35454) `+97/-7` cov=100% — install: load bunfig before resolving globalDir for -g installs
- [#35149](https://github.com/oven-sh/bun/pull/35149) `+140/-8` cov=100% — test(install): serve GitHub tarball fixtures locally in bun-add.test.ts
- [#35035](https://github.com/oven-sh/bun/pull/35035) `+11/-25` cov=100% — test(install): deflake SCP-style git URL test in bun-add.test.ts
- [#33168](https://github.com/oven-sh/bun/pull/33168) `+197/-4` cov=100% — install: parse a file: dependency on a workspace member as a workspace dependency
- [#32760](https://github.com/oven-sh/bun/pull/32760) `+486/-6` cov=100% — install: let `bun add <url>` replace a package installed from a different URL
- [#30659](https://github.com/oven-sh/bun/pull/30659) `+161/-2` cov=100% — install: stop `bun add -g` from walking above the global install dir
- [#36229](https://github.com/oven-sh/bun/pull/36229) `+502/-65` cov=75% — install: fix ENOENT race on shared cache when RENAME_EXCHANGE is unsupported (NFS) _(also: sys)_
- [#36200](https://github.com/oven-sh/bun/pull/36200) `+389/-184` cov=90% — install(windows): store bin-link metadata in :bunx NTFS stream instead of .bunx sidecar _(also: windows)_
- [#35598](https://github.com/oven-sh/bun/pull/35598) `+478/-39` cov=93% — install: preserve JSONC comments when rewriting package.json _(also: js-parser)_
- [#35576](https://github.com/oven-sh/bun/pull/35576) `+264/-33` cov=67% — install: skip reinstalling file:/URL tarball deps on second install
- [#34329](https://github.com/oven-sh/bun/pull/34329) `+389/-63` cov=67% — install: honor .npmrc //host/:_authToken= for tarballs on a different host than the registry
- [#34737](https://github.com/oven-sh/bun/pull/34737) `+219/-10` cov=86% — install: reject non-URL-friendly npm package names before registry routing
- [#30728](https://github.com/oven-sh/bun/pull/30728) `+702/-176` cov=92% — PathString: make init unsafe; audit call sites for outlives contract _(also: bundler, resolver)_
- [#30289](https://github.com/oven-sh/bun/pull/30289) `+1464/-8` cov=83% — install: isolated linker honors active bun link
- [#34170](https://github.com/oven-sh/bun/pull/34170) `+183/-17` cov=80% — install: let bunfig.toml registry take precedence over npm_config_registry _(also: toml)_
- [#30529](https://github.com/oven-sh/bun/pull/30529) `+431/-38` cov=80% — install: accept ms-style duration strings for minimumReleaseAge
- [#36294](https://github.com/oven-sh/bun/pull/36294) `+579/-127` cov=56% — install: preserve registry path without trailing slash; bunfig.toml over .npmrc _(also: toml)_
- [#35259](https://github.com/oven-sh/bun/pull/35259) `+150/-3` cov=75% — install: classify digit-prefixed dist-tags like `2x` as tags, not ranges
- [#32855](https://github.com/oven-sh/bun/pull/32855) `+96/-7` cov=100% — bun outdated: show in-range updates when installed >= `latest` dist-tag
- [#35602](https://github.com/oven-sh/bun/pull/35602) `+173/-1` cov=100% — install: warn when a link: dependency declares peerDependencies
- [#36127](https://github.com/oven-sh/bun/pull/36127) `+67/-1` cov=100% — cli(run): export INIT_CWD to package.json scripts
- [#35474](https://github.com/oven-sh/bun/pull/35474) `+1291/-43` cov=100% — run: shim npm/npx alongside node in the --bun PATH dir
- [#33800](https://github.com/oven-sh/bun/pull/33800) `+370/-0` cov=100% — run: translate npm workspace flags when rewriting npm run scripts
- [#34688](https://github.com/oven-sh/bun/pull/34688) `+119/-0` cov=100% — install: break folder dependency cycles in the hoist tree builder
- [#31120](https://github.com/oven-sh/bun/pull/31120) `+82/-0` cov=100% — Fix dangling PackageManager.log when JS runs during auto-install sleep_until _(also: jsc-bindings)_
- [#31298](https://github.com/oven-sh/bun/pull/31298) `+8/-0` cov=100% — bootstrap.ps1: rebuild PATH from registry before installing packages
- [#36279](https://github.com/oven-sh/bun/pull/36279) `+146/-14` cov=100% — pack: resolve workspace:* to the dependency's package.json version, not bun.lock's
- [#36266](https://github.com/oven-sh/bun/pull/36266) `+271/-2` cov=100% — pack: always include "main" and "browser" entry points in the tarball
- [#36260](https://github.com/oven-sh/bun/pull/36260) `+174/-60` cov=100% — pack/publish: warn and continue when the lockfile is unreadable
- [#36034](https://github.com/oven-sh/bun/pull/36034) `+55/-0` cov=100% — Bun.serve: server.publish() throws on null/undefined message
- [#35677](https://github.com/oven-sh/bun/pull/35677) `+189/-1` cov=100% — install: install devDependencies before running `prepare` for git dependencies
- [#35461](https://github.com/oven-sh/bun/pull/35461) `+355/-47` cov=90% — install: resolve link:./path relative to the project, not the global link dir
- [#34827](https://github.com/oven-sh/bun/pull/34827) `+245/-32` cov=100% — install: retry tarball and manifest downloads whose body is cut short
- [#34537](https://github.com/oven-sh/bun/pull/34537) `+222/-125` cov=67% — install: avoid quadratic scans in yarn.lock printer and bun.lock workspace parse
- [#36360](https://github.com/oven-sh/bun/pull/36360) `+1150/-324` cov=100% — install: honor --recursive/--filter in non-interactive bun update; re-resolve every named-update target
- [#35686](https://github.com/oven-sh/bun/pull/35686) `+36/-8` cov=100% — install(windows): write bunx.cmd (not bunx.exe) when hard link fails _(also: windows)_
- [#35653](https://github.com/oven-sh/bun/pull/35653) `+42/-8` cov=100% — cli: detect bunx when argv[0] ends with bunx.exe on posix
- [#34110](https://github.com/oven-sh/bun/pull/34110) `+439/-9` cov=100% — bunx: honor the project-local bunfig.toml [install] registry _(also: toml)_
- [#34109](https://github.com/oven-sh/bun/pull/34109) `+73/-2` cov=100% — install: bypass manifest cache for `bun outdated`
- [#33182](https://github.com/oven-sh/bun/pull/33182) `+850/-32` cov=100% — install: honor --recursive and --filter in non-interactive bun update
- [#32947](https://github.com/oven-sh/bun/pull/32947) `+209/-30` cov=100% — install: make `bun update <name>` re-resolve every dependency on `<name>`
- [#32810](https://github.com/oven-sh/bun/pull/32810) `+517/-12` cov=100% — install: make `bun update <name>` update catalog entries instead of adding a root dependency
- [#32150](https://github.com/oven-sh/bun/pull/32150) `+378/-51` cov=100% — bunx: use globally installed packages before downloading
- [#29794](https://github.com/oven-sh/bun/pull/29794) `+563/-2` cov=100% — install: prune stale workspace node_modules in hoisted installs
- [#30874](https://github.com/oven-sh/bun/pull/30874) `+306/-161` cov=86% — bun_core: add AtomicPtrCell<T>, migrate pointer AtomicCell sites _(also: resolver, jsc-bindings)_
- [#35586](https://github.com/oven-sh/bun/pull/35586) `+90/-96` cov=100% — install: preserve package.json key order when bun remove empties a dependency group _(also: js-parser)_
- [#35818](https://github.com/oven-sh/bun/pull/35818) `+96/-3` cov=100% — install: show blocked-postinstall notice when registry omits hasInstallScript
- [#35807](https://github.com/oven-sh/bun/pull/35807) `+57/-0` cov=100% — install: honor `npm_config_ignore_scripts` from the environment
- [#35626](https://github.com/oven-sh/bun/pull/35626) `+1/-2` cov=100% — test: enable 'bun pm trust' CPU usage test on Windows _(also: windows)_
- [#35106](https://github.com/oven-sh/bun/pull/35106) `+741/-144` cov=100% — install: make `bun pm untrusted`/`trust` see packages under the isolated linker
- [#32515](https://github.com/oven-sh/bun/pull/32515) `+84/-15` cov=100% — install: skip non-absolute $BUN_INSTALL when locating global dirs
- [#32305](https://github.com/oven-sh/bun/pull/32305) `+40/-8` cov=100% — install: re-raise raw signal when lifecycle script is signaled
- [#32294](https://github.com/oven-sh/bun/pull/32294) `+67/-4` cov=100% — install: write failed lifecycle script output verbatim
- [#31197](https://github.com/oven-sh/bun/pull/31197) `+345/-13` cov=100% — install: preserve empty trustedDependencies across install + lockfile round-trip
- [#36163](https://github.com/oven-sh/bun/pull/36163) `+349/-125` cov=86% — resolver: inherit auto-install settings in Worker threads _(also: jsc-bindings, resolver)_
- [#36387](https://github.com/oven-sh/bun/pull/36387) `+32/-1` cov=100% — install: fix false "Workspace name already exists" on truncated-hash collisions
- [#36381](https://github.com/oven-sh/bun/pull/36381) `+279/-127` cov=100% — install: sync bun.lock catalog with package.json on bun update
- [#36379](https://github.com/oven-sh/bun/pull/36379) `+73/-3` cov=100% — install: re-resolve catalog references on plain `bun update` from the workspace root
- [#36289](https://github.com/oven-sh/bun/pull/36289) `+88/-23` cov=100% — install: fall back to $HOME/.npmrc when $XDG_CONFIG_HOME is set
- [#36285](https://github.com/oven-sh/bun/pull/36285) `+182/-0` cov=100% — install: update bun.lock workspace versions when only the version changes
- [#36167](https://github.com/oven-sh/bun/pull/36167) `+164/-11` cov=100% — install: resolve concurrent auto-install cache races into a shared cache dir
- [#36159](https://github.com/oven-sh/bun/pull/36159) `+104/-7` cov=100% — install: stop running the JS event loop inside the auto-install resolver wait _(also: resolver)_
- [#35072](https://github.com/oven-sh/bun/pull/35072) `+112/-52` cov=100% — json: reject content after the root value (JSONC, package.json, tsconfig, bundler loaders) _(also: bundler)_
- [#34327](https://github.com/oven-sh/bun/pull/34327) `+72/-1` cov=100% — install: honor bun.lockb trustedDependencies sentinel in `bun pm untrusted`/`trust`
- [#32677](https://github.com/oven-sh/bun/pull/32677) `+994/-210` cov=60% — patch: refuse symlink and hard link escapes when applying patches _(also: sys)_
- [#31032](https://github.com/oven-sh/bun/pull/31032) `+10/-6` cov=100% — install(security-scanner): gate post-start() deref on Ok to avoid over-deref
- [#29664](https://github.com/oven-sh/bun/pull/29664) `+204/-6` cov=100% — install: hoist `catalog:` peer dependencies like their resolved npm range
- [#29594](https://github.com/oven-sh/bun/pull/29594) `+130/-24` cov=100% — install: ignore `patchedDependencies` from folder dependency's package.json
- [#29345](https://github.com/oven-sh/bun/pull/29345) `+83/-1` cov=100% — install: dedupe isolated-linker entries in peer-dep cycles
- [#28936](https://github.com/oven-sh/bun/pull/28936) `+829/-15` cov=100% — pm version: update bun.lock for workspace packages
- [#35558](https://github.com/oven-sh/bun/pull/35558) `+94/-27` cov=31% — install: document that --production implies --frozen-lockfile
- [#35799](https://github.com/oven-sh/bun/pull/35799) `+315/-25` cov=100% — worker_threads: make MessagePort's on()/addEventListener() share one listener registry
- [#35585](https://github.com/oven-sh/bun/pull/35585) `+157/-2` cov=100% — install(windows): remove .bunx/.exe shims on `bun remove` _(also: windows)_
- [#35563](https://github.com/oven-sh/bun/pull/35563) `+52/-5` cov=100% — bun patch: accept absolute Windows paths from inside workspace packages _(also: windows)_
- [#35457](https://github.com/oven-sh/bun/pull/35457) `+250/-6` cov=50% — install: warn when resolving deprecated npm packages
- [#34208](https://github.com/oven-sh/bun/pull/34208) `+61/-0` cov=100% — worker_threads: publish the 'worker_threads' diagnostics channel on new Worker
- [#33573](https://github.com/oven-sh/bun/pull/33573) `+65/-3` cov=100% — install: create patch parent dirs with directory mode, not file mode
- [#32749](https://github.com/oven-sh/bun/pull/32749) `+205/-3` cov=100% — install: hash patch contents with SHA-1 instead of Wyhash11
- [#28669](https://github.com/oven-sh/bun/pull/28669) `+136/-1` cov=100% — Add --cwd support to bunx
- [#35905](https://github.com/oven-sh/bun/pull/35905) `+226/-6` cov=71% — Add suppressErrors option to Bun.Glob scan/scanSync
- [#30522](https://github.com/oven-sh/bun/pull/30522) `+2568/-15` cov=61% — publish: add --provenance (npm provenance via Sigstore keyless signing) _(also: node-fs)_
- [#35620](https://github.com/oven-sh/bun/pull/35620) `+41/-65` cov=100% — test(filter-workspace): assert --elide-lines on the final redraw frame
- [#35141](https://github.com/oven-sh/bun/pull/35141) `+135/-68` cov=100% — bunfig: error on wrong-typed [install] keys instead of silently ignoring
- [#33701](https://github.com/oven-sh/bun/pull/33701) `+512/-37` cov=80% — install: accept any digest of the strongest integrity algorithm (SSRI any-match)
- [#33142](https://github.com/oven-sh/bun/pull/33142) `+105/-1` cov=100% — link: don't chdir into the global dir for `bun link -g` / `bun unlink -g`
- [#32306](https://github.com/oven-sh/bun/pull/32306) `+108/-2` cov=100% — install: reject bun.lockb with cyclic tree parents instead of returning a wrong path
- [#31154](https://github.com/oven-sh/bun/pull/31154) `+136/-32` cov=100% — install: make `--cwd` chdir idempotent across re-parses
- [#28531](https://github.com/oven-sh/bun/pull/28531) `+278/-12` cov=90% — Enable auto-install for bun build and Bun.build() _(also: bundler, resolver)_
- [#36126](https://github.com/oven-sh/bun/pull/36126) `+142/-49` cov=100% — run: point NODE/npm_node_execpath at the shim executable, not its directory
- [#35565](https://github.com/oven-sh/bun/pull/35565) `+124/-84` cov=100% — run: scope the --bun node shim directory by uid
- [#34983](https://github.com/oven-sh/bun/pull/34983) `+177/-8` cov=75% — cli: make -c/--config require a path; stop treating the config path as a package to install
- [#33528](https://github.com/oven-sh/bun/pull/33528) `+149/-7` cov=75% — install: re-apply patch when cached patched folder lacks its bun-tag marker
- [#30458](https://github.com/oven-sh/bun/pull/30458) `+205/-0` cov=100% — cli: sync PWD env var with --cwd chdir
- [#35710](https://github.com/oven-sh/bun/pull/35710) `+562/-77` cov=73% — cli: forward .env to `bun run <script>` / bunx subprocesses
- [#35371](https://github.com/oven-sh/bun/pull/35371) `+736/-770` cov=88% — install: replace *mut PackageManager self-aliasing with disjoint field borrows
- [#36392](https://github.com/oven-sh/bun/pull/36392) `+135/-3` cov=40% — install: remove stale bin symlinks when an update drops a bin entry
- [#33127](https://github.com/oven-sh/bun/pull/33127) `+1196/-333` cov=80% — install: write the resolved version into the lockfile for bun update
- [#32245](https://github.com/oven-sh/bun/pull/32245) `+306/-21` cov=93% — http: reject fetch() instead of panicking when the HTTP client thread fails to spawn _(also: spawn)_
- [#32845](https://github.com/oven-sh/bun/pull/32845) `+1456/-1320` cov=88% — rust: adopt bon for compile-checked struct and function builders _(also: bundler)_
- [#34919](https://github.com/oven-sh/bun/pull/34919) `+40/-74` cov=100% — http: ignore Transfer-Encoding: chunked on 1xx/204/304; remove force_last_modified
- [#34317](https://github.com/oven-sh/bun/pull/34317) `+58/-11` cov=100% — cli: restore `<name>`/`<package>` placeholders in package-manager `--help`
- [#36458](https://github.com/oven-sh/bun/pull/36458) `+27/-19` cov=67% — install: refuse to overwrite a bun.lock with a newer lockfileVersion
- [#33469](https://github.com/oven-sh/bun/pull/33469) `+667/-102` cov=91% — fetch: stop replacing unrecognized HTTP methods with GET
- [#35650](https://github.com/oven-sh/bun/pull/35650) `+198/-34` cov=93% — output: enable ANSI colors by default on CI providers that render them _(also: jsc-bindings, ci-build)_
- [#31150](https://github.com/oven-sh/bun/pull/31150) `+221/-2` cov=86% — skip security scanner for child `bun install` spawned by `bun create`
- [#35599](https://github.com/oven-sh/bun/pull/35599) `+133/-0` cov=75% — bunx: parse --env-file
- [#35542](https://github.com/oven-sh/bun/pull/35542) `+203/-7` cov=75% — install: accept -E/--exact for bun update
- [#31415](https://github.com/oven-sh/bun/pull/31415) `+286/-27` cov=62% — perf: use `as_chunks*` instead of `chunks_exact*` for static chunk sizes _(also: js-parser)_
- [#35426](https://github.com/oven-sh/bun/pull/35426) `+468/-54` cov=80% — install: fix git dependencies that share one repository
- [#31868](https://github.com/oven-sh/bun/pull/31868) `+569/-56` cov=62% — install: refresh URL/local tarballs under --force and explicit re-add/update
- [#31391](https://github.com/oven-sh/bun/pull/31391) `+284/-4` cov=56% — install(windows-shim): handle `env -S` in bin shebang parser _(also: windows, js-parser)_
- [#35253](https://github.com/oven-sh/bun/pull/35253) `+113/-34` cov=100% — bun create: supply a fallback git identity when none is configured
- [#31743](https://github.com/oven-sh/bun/pull/31743) `+2379/-226` cov=80% — Add delta updates and `bun upgrade pr <number>` _(also: ci-build)_
- [#31614](https://github.com/oven-sh/bun/pull/31614) `+547/-134` cov=75% — paths: make path_buffer_pool lock-free and process-global
- [#29310](https://github.com/oven-sh/bun/pull/29310) `+465/-66` cov=80% — Walk up for bunfig.toml when running from a subdirectory _(also: jsc-bindings, toml)_
- [#35540](https://github.com/oven-sh/bun/pull/35540) `+2331/-2170` cov=83% — install: keep empty resolved fields of already-locked packages in bun.lock
- [#29496](https://github.com/oven-sh/bun/pull/29496) `+1012/-308` cov=75% — install: parallelize hoisted package linking on fresh node_modules
- [#35890](https://github.com/oven-sh/bun/pull/35890) `+82/-2` cov=100% — audit: decompress gzip responses served without Content-Encoding
- [#30751](https://github.com/oven-sh/bun/pull/30751) `+631/-3` cov=75% — bunx: forward --minimum-release-age to spawned bun add
- [#30556](https://github.com/oven-sh/bun/pull/30556) `+161/-21` cov=100% — Fix bun patch --commit cross-drive rename on Windows _(also: windows)_
- [#28773](https://github.com/oven-sh/bun/pull/28773) `+161/-5` cov=100% — Fix global bin path warnings: double backslashes on Windows and trailing slash PATH detection _(also: windows)_
- [#33739](https://github.com/oven-sh/bun/pull/33739) `+152/-15` cov=67% — semver: collapse a || union containing a match-all branch to * before the prerelease rule
- [#35886](https://github.com/oven-sh/bun/pull/35886) `+111/-237` cov=81% — fetch: don't let the Host request header steer TLS SNI / certificate verification
- [#30340](https://github.com/oven-sh/bun/pull/30340) `+854/-1` cov=67% — Add install.blockExoticSubdeps to reject non-registry transitive deps
- [#35168](https://github.com/oven-sh/bun/pull/35168) `+184/-3` cov=67% — install: print a warning on each idle-timeout retry
- [#30582](https://github.com/oven-sh/bun/pull/30582) `+534/-1` cov=67% — install: add install.forceRegistry for device-wide registry enforcement
- [#32753](https://github.com/oven-sh/bun/pull/32753) `+224/-1` cov=67% — install: validate bun.lockb slice descriptors and ids at load time
- [#33738](https://github.com/oven-sh/bun/pull/33738) `+4015/-3929` cov=71% — semver: add "-0" prerelease floor to derived exclusive upper bounds
- [#34784](https://github.com/oven-sh/bun/pull/34784) `+672/-269` cov=69% — Replace bytemuck with in-tree bun_core::cast module _(also: js-parser, windows)_
- [#36464](https://github.com/oven-sh/bun/pull/36464) `+224/-6` cov=62% — install: add [install.lockfile] lockfileVersion to cap bun.lock lockfileVersion
- [#35667](https://github.com/oven-sh/bun/pull/35667) `+48/-10` cov=75% — js_printer: balance indent for single-line E.Object in JSON mode _(also: js-parser)_
- [#33198](https://github.com/oven-sh/bun/pull/33198) `+114/-8` cov=75% — Make CLI flags override their [run] counterparts in bunfig.toml _(also: toml)_
- [#30863](https://github.com/oven-sh/bun/pull/30863) `+30/-4` cov=50% — install.sh: detect FreeBSD and Android/Termux targets
- [#29509](https://github.com/oven-sh/bun/pull/29509) `+606/-0` cov=60% — install: add `bun pm fetch`
- [#35143](https://github.com/oven-sh/bun/pull/35143) `+446/-55` cov=69% — cli: reject unknown --long flags instead of silently dropping them _(also: ci-build, bundler)_
- [#29512](https://github.com/oven-sh/bun/pull/29512) `+1503/-1` cov=56% — Add `bun pm sbom` command
- [#33737](https://github.com/oven-sh/bun/pull/33737) `+111/-18` cov=50% — Bun.semver: accept trailing whitespace like node-semver
- [#33736](https://github.com/oven-sh/bun/pull/33736) `+45/-27` cov=50% — semver: treat tab/CR/LF as comparator separators in range parsing
- [#33626](https://github.com/oven-sh/bun/pull/33626) `+58/-0` cov=50% — semver: zero trailing components after wildcard in hyphen-range left endpoint
- [#33625](https://github.com/oven-sh/bun/pull/33625) `+87/-26` cov=50% — semver: classify prerelease identifiers by character class, not u64 parse
- [#32998](https://github.com/oven-sh/bun/pull/32998) `+49/-3` cov=50% — semver: return false from satisfies() for an invalid version argument
- [#32993](https://github.com/oven-sh/bun/pull/32993) `+35/-2` cov=50% — semver: parse space-separated comparators as an intersection, not alternatives
- [#32985](https://github.com/oven-sh/bun/pull/32985) `+82/-14` cov=50% — semver: treat '-' inside build metadata as an identifier character
- [#28515](https://github.com/oven-sh/bun/pull/28515) `+475/-5` cov=62% — Add `--changelog` flag to `bun outdated`
- [#35622](https://github.com/oven-sh/bun/pull/35622) `+220/-3` cov=67% — bun test: forward args after -- to process.argv _(also: test-runner)_
- [#31950](https://github.com/oven-sh/bun/pull/31950) `+187/-3` cov=67% — Report connection resets during the TLS handshake as ECONNRESET instead of a certificate error
- [#35568](https://github.com/oven-sh/bun/pull/35568) `+282/-13` cov=50% — install(windows): extend EPERM retry when moving extracted package into cache _(also: windows)_
- [#34650](https://github.com/oven-sh/bun/pull/34650) `+190/-4` cov=50% — install: re-download tarball when auto-install resolves from the .npm manifest cache
- [#32843](https://github.com/oven-sh/bun/pull/32843) `+502/-70` cov=33% — install: match npm's version resolution for prerelease ranges, || groups, and `*`
- [#35566](https://github.com/oven-sh/bun/pull/35566) `+233/-6` cov=50% — install: fetch new tags/branches when updating a cached git dependency
- [#35384](https://github.com/oven-sh/bun/pull/35384) `+147/-102` cov=50% — test(install): run yarn-lock migration tests against a loopback registry
- [#35026](https://github.com/oven-sh/bun/pull/35026) `+100/-7` cov=50% — install: fix try_ssh scp-style fallback URL truncation
- [#31031](https://github.com/oven-sh/bun/pull/31031) `+220/-33` cov=50% — install: allow dev security scanner under `--production`
- [#29588](https://github.com/oven-sh/bun/pull/29588) `+427/-9` cov=50% — http: publish to http.server.* diagnostics_channel channels
- [#35589](https://github.com/oven-sh/bun/pull/35589) `+131/-1` cov=50% — cli: honor --bun / [run] bun for `bun <file>` and `bun -e`
- [#33007](https://github.com/oven-sh/bun/pull/33007) `+446/-103` cov=67% — fetch: make the in-flight request cap per-origin instead of process-global
- [#31013](https://github.com/oven-sh/bun/pull/31013) `+263/-32` cov=67% — audit: apply --audit-level and --ignore filters to --json output
- [#36149](https://github.com/oven-sh/bun/pull/36149) `+174/-48` cov=62% — fetch(tls): surface ERR_OSSL_* for bad client cert/key instead of FailedToOpenSocket _(also: crypto)_
- [#33115](https://github.com/oven-sh/bun/pull/33115) `+11667/-14895` cov=38% — test: replace verdaccio and the mock npm servers with an in-process spec-compliant registry
- [#34987](https://github.com/oven-sh/bun/pull/34987) `+278/-81` cov=50% — bunfig: load global ~/.bunfig.toml for runtime commands; fall back past $XDG_CONFIG_HOME _(also: toml)_
- [#34313](https://github.com/oven-sh/bun/pull/34313) `+132/-26` cov=50% — cli: keep unknown <tag> placeholders in --help descriptions
- [#33101](https://github.com/oven-sh/bun/pull/33101) `+477/-147` cov=20% — redis: support binary pub/sub payloads (publish + subscribeBuffer)
- [#34687](https://github.com/oven-sh/bun/pull/34687) `+305/-2320` cov=12% — test(install): make complex-workspace migration test hermetic
- [#36215](https://github.com/oven-sh/bun/pull/36215) `+1579/-13007` cov=40% — test(install): run security-scanner matrix concurrently
- [#35363](https://github.com/oven-sh/bun/pull/35363) `+1719/-2343` cov=86% — ast: retire ambient thread-local AST allocator; make the arena a passed value _(also: bundler, js-parser)_
- [#29470](https://github.com/oven-sh/bun/pull/29470) `+1513/-5` cov=33% — darwin: add universal macOS .pkg installer _(also: ci-build)_
- [#36162](https://github.com/oven-sh/bun/pull/36162) `+237/-38` cov=33% — paths: terminate recursive mkdir walk when a confirmed parent still yields ENOENT
- [#29475](https://github.com/oven-sh/bun/pull/29475) `+1267/-4` cov=25% — Add Windows MSI installer built in CI _(also: ci-build, windows)_
- [#36274](https://github.com/oven-sh/bun/pull/36274) `+23/-9` cov=0% — docker: install git in the default debian image
- [#36273](https://github.com/oven-sh/bun/pull/36273) `+36/-10` cov=0% — docker: install adduser in Debian image final stages
- [#36226](https://github.com/oven-sh/bun/pull/36226) `+262/-3` cov=0% — console: publish to diagnostics_channel console.* built-in channels
- [#35915](https://github.com/oven-sh/bun/pull/35915) `+63/-39` cov=0% — test(install): speed up bun-install-streaming-extract.test.ts (65s to 10s debug-asan)
- [#35377](https://github.com/oven-sh/bun/pull/35377) `+36/-25` cov=0% — test(install): fix yarn-lock-migration yarn-cli-repo case under debug+ASAN
- [#35235](https://github.com/oven-sh/bun/pull/35235) `+142/-32` cov=0% — docs(websocket): clarify that publish() returns the worst subscriber status
- [#34175](https://github.com/oven-sh/bun/pull/34175) `+28/-29` cov=0% — test(install-proxy): run iterations sequentially to avoid squid saturation
- [#33288](https://github.com/oven-sh/bun/pull/33288) `+197/-4` cov=0% — diagnostics_channel: snapshot the subscriber list per publish
- [#33171](https://github.com/oven-sh/bun/pull/33171) `+369/-32` cov=0% — vscode: resolve bun.runtime and test settings per workspace folder
- [#30249](https://github.com/oven-sh/bun/pull/30249) `+35/-6` cov=0% — docs: list supported lifecycle scripts, note that npm's `dependencies` script is not implemented
- [#30080](https://github.com/oven-sh/bun/pull/30080) `+273/-2` cov=0% — child_process: publish diagnostics_channel events for node:child_process spawn/fork/exec/execFile _(also: spawn)_

### ci-build — .buildkite, .github/workflows, scripts/build, cmake, WebKit bumps
_core ownership · 116 PRs total, 115 above threshold_

- [#35328](https://github.com/oven-sh/bun/pull/35328) `+45/-18` cov=100% — ci: link PR builds with the base branch symbol order file
- [#34877](https://github.com/oven-sh/bun/pull/34877) `+184/-50` cov=100% — ci(verify-baseline): parse //@ JSC flags, skip v128 wasm fixtures on x64, re-enable --jit-stress on WebKit changes _(also: jsc-bindings)_
- [#34681](https://github.com/oven-sh/bun/pull/34681) `+6/-1` cov=100% — ci: bump darwin test-bun parallelism 2 -> 5
- [#34480](https://github.com/oven-sh/bun/pull/34480) `+40/-1` cov=100% — ci: wait for dockerd before launching the test-service coordinator on Linux agents
- [#32512](https://github.com/oven-sh/bun/pull/32512) `+64/-2` cov=100% — build: reject prebuilt baseline macOS builds (no Nehalem macOS WebKit) _(also: webkit-upgrade)_
- [#31873](https://github.com/oven-sh/bun/pull/31873) `+23/-8` cov=100% — ci: mirror Intel SDE on CI asset host and fail fast on a bad baseline download
- [#34299](https://github.com/oven-sh/bun/pull/34299) `+204/-287` cov=84% — [build images] Upgrade LLVM toolchain from 21.1.8 to 22.1.8 _(also: jsc-bindings, webkit-upgrade)_
- [#36472](https://github.com/oven-sh/bun/pull/36472) `+116/-1` cov=100% — inspector: bump WebKit so Console.enable replay survives validateExceptionChecks _(also: webkit-upgrade)_
- [#36364](https://github.com/oven-sh/bun/pull/36364) `+60/-1` cov=100% — Intl.DurationFormat: per-unit numeric style forces minutes/seconds display _(also: webkit-upgrade)_
- [#36362](https://github.com/oven-sh/bun/pull/36362) `+41/-1` cov=100% — Intl.NumberFormat: fix percent formatRange scaling twice on approximately path _(also: webkit-upgrade)_
- [#36361](https://github.com/oven-sh/bun/pull/36361) `+38/-1` cov=100% — Bump WebKit: omit dayPeriod from Intl.DateTimeFormat resolvedOptions for bare 12-hour patterns _(also: webkit-upgrade)_
- [#36356](https://github.com/oven-sh/bun/pull/36356) `+85/-1` cov=100% — jsc: let worker.terminate() preempt pure-Wasm loops _(also: webkit-upgrade, jsc-bindings)_
- [#36321](https://github.com/oven-sh/bun/pull/36321) `+43/-1` cov=100% — ShadowRealm: cache importValue module in its own realm under require(esm) _(also: webkit-upgrade)_
- [#36262](https://github.com/oven-sh/bun/pull/36262) `+38/-1` cov=100% — jsc: don't leak builtin @-identifiers in TypeError messages (debug/ASAN) _(also: webkit-upgrade, jsc-bindings)_
- [#36197](https://github.com/oven-sh/bun/pull/36197) `+71/-1` cov=100% — Intl.DateTimeFormat: keep timeStyle literal separators in formatRange for ja/ko/th _(also: webkit-upgrade)_
- [#36195](https://github.com/oven-sh/bun/pull/36195) `+38/-1` cov=100% — Intl.Collator: honor locale-tailored caseFirst default (da, mt) _(also: webkit-upgrade)_
- [#36137](https://github.com/oven-sh/bun/pull/36137) `+109/-2` cov=100% — jsc: make control-flow-profiler getExecutedRanges linear instead of quadratic _(also: webkit-upgrade, jsc-bindings)_
- [#36103](https://github.com/oven-sh/bun/pull/36103) `+97/-1` cov=100% — String.prototype.localeCompare: reuse collator for (string locale, no options) _(also: webkit-upgrade)_
- [#36029](https://github.com/oven-sh/bun/pull/36029) `+76/-1` cov=100% — Bun.JSONL: reject extra content on a line instead of silently dropping it _(also: webkit-upgrade)_
- [#35938](https://github.com/oven-sh/bun/pull/35938) `+39/-1` cov=100% — jsc: avoid quadratic basic block linking and liveness for deeply nested array destructuring _(also: webkit-upgrade, jsc-bindings)_
- [#35925](https://github.com/oven-sh/bun/pull/35925) `+82/-1` cov=100% — jsc: throw RangeError for deeply nested array destructuring instead of SIGSEGV _(also: webkit-upgrade, jsc-bindings)_
- [#35904](https://github.com/oven-sh/bun/pull/35904) `+93/-1` cov=100% — jsc: sub-quadratic BigInt toString and multiply _(also: webkit-upgrade, jsc-bindings)_
- [#35900](https://github.com/oven-sh/bun/pull/35900) `+72/-1` cov=100% — Intl.Locale: throw RangeError for structurally valid tags that exceed ICU capacity _(also: webkit-upgrade)_
- [#35899](https://github.com/oven-sh/bun/pull/35899) `+115/-1` cov=100% — BigInt("0x…"/"0b…"/"0o…"): linear-time string parse _(also: webkit-upgrade)_
- [#35895](https://github.com/oven-sh/bun/pull/35895) `+48/-1` cov=100% — Intl.Locale: stop leaking ICU's "yes" sentinel from keyword getters _(also: webkit-upgrade)_
- [#35876](https://github.com/oven-sh/bun/pull/35876) `+147/-1` cov=100% — jsc: TypedArray indexed access at 4294967295 on a 2**32-length view _(also: webkit-upgrade, jsc-bindings)_
- [#35754](https://github.com/oven-sh/bun/pull/35754) `+258/-1` cov=100% — jsc: treat BunTranspiledModule as Module in JSC debugger/inspector switches _(also: webkit-upgrade, jsc-bindings)_
- [#35687](https://github.com/oven-sh/bun/pull/35687) `+49/-1` cov=100% — jsc: make named capture group regex compilation linear instead of quadratic _(also: webkit-upgrade, jsc-bindings)_
- [#35683](https://github.com/oven-sh/bun/pull/35683) `+135/-1` cov=100% — RegExp: throw RangeError when YARR exhausts its match budget _(also: webkit-upgrade)_
- [#35532](https://github.com/oven-sh/bun/pull/35532) `+102/-1` cov=100% — Promise.any: give the rejected AggregateError a stack, message, and no spurious cause _(also: webkit-upgrade)_
- [#35490](https://github.com/oven-sh/bun/pull/35490) `+212/-1` cov=100% — jsc: JIT simple fixed-width regex lookbehinds _(also: webkit-upgrade, jsc-bindings)_
- [#35479](https://github.com/oven-sh/bun/pull/35479) `+336/-126` cov=100% — inspector: enumerate module-scope bindings in Debugger.paused scope chain _(also: webkit-upgrade, jsc-bindings)_
- [#35478](https://github.com/oven-sh/bun/pull/35478) `+1/-1` cov=100% — Object.seal/freeze: take the JSObject fast path for arrays and indexed objects _(also: webkit-upgrade)_
- [#35333](https://github.com/oven-sh/bun/pull/35333) `+79/-3` cov=100% — inspector: bump WebKit so Runtime.evaluate survives validateExceptionChecks _(also: webkit-upgrade)_
- [#35291](https://github.com/oven-sh/bun/pull/35291) `+147/-2` cov=100% — Date.toString(): resolve the parenthesized zone name at the instant _(also: webkit-upgrade)_
- [#35290](https://github.com/oven-sh/bun/pull/35290) `+148/-1` cov=100% — Date.parse: accept Unicode whitespace (NBSP, Zs, BOM) like V8 _(also: webkit-upgrade)_
- [#35194](https://github.com/oven-sh/bun/pull/35194) `+150/-1` cov=100% — jsc: throw RangeError from JSON.parse when a string value cannot be allocated _(also: webkit-upgrade, jsc-bindings)_
- [#35193](https://github.com/oven-sh/bun/pull/35193) `+68/-1` cov=100% — Bump WebKit: fix BCRASH being compiled away on Windows clang-cl (BUN-2Z94) _(also: webkit-upgrade, windows)_
- [#34762](https://github.com/oven-sh/bun/pull/34762) `+32/-2` cov=100% — Intl.Collator: throw RangeError instead of aborting on a 2^30-byte Latin-1 operand _(also: webkit-upgrade)_
- [#34655](https://github.com/oven-sh/bun/pull/34655) `+73/-1` cov=100% — JSModuleLoader: don't abort when terminate() lands during a worker's preload resolve() _(also: webkit-upgrade)_
- [#34352](https://github.com/oven-sh/bun/pull/34352) `+320/-51` cov=100% — Windows x64 ASAN: wire the release-asan build and get it running _(also: jsc-bindings, webkit-upgrade)_
- [#34339](https://github.com/oven-sh/bun/pull/34339) `+46/-1` cov=100% — jsc: throw RangeError for deeply nested object/array literals instead of hanging _(also: webkit-upgrade, jsc-bindings)_
- [#34277](https://github.com/oven-sh/bun/pull/34277) `+25/-1` cov=100% — Fix AsyncLocalStorage context loss in thenables returned from async functions _(also: webkit-upgrade)_
- [#34238](https://github.com/oven-sh/bun/pull/34238) `+121/-1` cov=100% — Add JIT intrinsics for DataView BigInt64/BigUint64 accessors (WebKit upgrade) _(also: webkit-upgrade)_
- [#34138](https://github.com/oven-sh/bun/pull/34138) `+114/-1` cov=100% — jsc: fix O(n^3) YARR JIT backtracking for greedy /u character classes _(also: webkit-upgrade, jsc-bindings)_
- [#33961](https://github.com/oven-sh/bun/pull/33961) `+148/-1` cov=100% — module-loader: resume suspended TLA body when a cycle sibling throws _(also: webkit-upgrade)_
- [#33808](https://github.com/oven-sh/bun/pull/33808) `+58/-1` cov=100% — Add regression test for AsyncLocalStorage context loss in .then() continuations after DFG tier-up _(also: webkit-upgrade)_
- [#33248](https://github.com/oven-sh/bun/pull/33248) `+35/-0` cov=100% — build: disable clang-cl's default stack buffer security check on Windows release (/GS-) _(also: windows)_
- [#33247](https://github.com/oven-sh/bun/pull/33247) `+53/-0` cov=100% — build: merge identical functions during the Linux LTO link; strip .comment and .note.stapsdt
- [#33223](https://github.com/oven-sh/bun/pull/33223) `+64/-2` cov=100% — Fix wasm streaming plan state regression when a function body fails validation _(also: webkit-upgrade)_
- [#31679](https://github.com/oven-sh/bun/pull/31679) `+116/-1` cov=100% — Add JIT-tier regression tests for int32-boundary parseInt/Map/switch values; fix local WebKit LTO flags _(also: webkit-upgrade)_
- [#31161](https://github.com/oven-sh/bun/pull/31161) `+111/-5` cov=100% — Fix event-loop hang when dlopen'd Go/cgo lib coexists with WASM on Linux _(also: webkit-upgrade)_
- [#30620](https://github.com/oven-sh/bun/pull/30620) `+93/-2` cov=100% — Intl.DateTimeFormat: accept legacy IANA primary zones (CET, CST6CDT, EET, EST5EDT, MET, MST7MDT, PST8PDT, WET) on Linux/Windows _(also: webkit-upgrade, windows)_
- [#33117](https://github.com/oven-sh/bun/pull/33117) `+284/-54` cov=67% — ci: recover test-bun from Buildkite artifact-download failures
- [#36079](https://github.com/oven-sh/bun/pull/36079) `+18/-4` cov=100% — ci: spawn the docker test-service coordinator on darwin shards too _(also: spawn)_
- [#35097](https://github.com/oven-sh/bun/pull/35097) `+166/-51` cov=62% — build: omit bun:internal-for-testing from non-canary release builds _(also: node-fs)_
- [#34665](https://github.com/oven-sh/bun/pull/34665) `+12/-0` cov=100% — ci(asan): enable JSC validateGraphAtEachPhase on ASAN test lanes _(also: jsc-bindings)_
- [#34569](https://github.com/oven-sh/bun/pull/34569) `+32/-4` cov=100% — ci(vendor): add skipTestNames so a single upstream test can be skipped by name
- [#34367](https://github.com/oven-sh/bun/pull/34367) `+26/-4` cov=100% — ci(macos): move the nightly builds/ wipe to agent-startup; reboot-only cleanup daemon
- [#33153](https://github.com/oven-sh/bun/pull/33153) `+265/-40` cov=75% — build: fetch and patch rust-argon2 as a vendored cargo path dependency
- [#35751](https://github.com/oven-sh/bun/pull/35751) `+219/-31` cov=86% — build(linux): enable full RELRO, stack canaries, and _FORTIFY_SOURCE=3 _(also: jsc-bindings, bundler)_
- [#34683](https://github.com/oven-sh/bun/pull/34683) `+611/-0` cov=67% — ci: add lint:tests to catch flake anti-patterns in new test code
- [#34428](https://github.com/oven-sh/bun/pull/34428) `+151/-42` cov=75% — WebKit: use GetSystemTimePreciseAsFileTime for WallTime and QPC for MonotonicTime on Windows _(also: webkit-upgrade, windows)_
- [#29683](https://github.com/oven-sh/bun/pull/29683) `+177/-7` cov=100% — build(linux-musl): statically link libstdc++/libgcc
- [#34355](https://github.com/oven-sh/bun/pull/34355) `+73/-0` cov=100% — ci(windows): stash multi-line env vars around Enter-VsDevShell _(also: windows)_
- [#36339](https://github.com/oven-sh/bun/pull/36339) `+197/-30` cov=100% — ci(build): keep waiting for build-cpp while a retry is queued instead of bailing on a stale errored outcome
- [#33339](https://github.com/oven-sh/bun/pull/33339) `+280/-10` cov=67% — build: pin -C metadata so bun's crates keep stable symbol names
- [#34876](https://github.com/oven-sh/bun/pull/34876) `+921/-501` cov=44% — build: make codegen runnable under Node; drop cfg.bun
- [#35944](https://github.com/oven-sh/bun/pull/35944) `+22/-1` cov=100% — runner: keep docker-build and test-buffer-constants out of the N-wide phase _(also: test-runner)_
- [#36203](https://github.com/oven-sh/bun/pull/36203) `+988/-4` cov=78% — http: SSPI Negotiate/NTLM proxy authentication on Windows _(also: windows)_
- [#35906](https://github.com/oven-sh/bun/pull/35906) `+367/-35` cov=100% — ci(binary-size): per-target merge-base baselines so a stale main baseline can't fail every PR
- [#33910](https://github.com/oven-sh/bun/pull/33910) `+1202/-1514` cov=56% — boringssl: replace hand-rolled FFI with upstream bssl-sys/crypto/x509/tls _(also: crypto, sys)_
- [#32761](https://github.com/oven-sh/bun/pull/32761) `+2055/-22` cov=67% — run: render a live pane per --parallel task on an interactive terminal
- [#34640](https://github.com/oven-sh/bun/pull/34640) `+75/-3` cov=50% — jsc: treat DFG Plan::m_mustHandleValues as weak so queued compiles don't root user objects _(also: webkit-upgrade, jsc-bindings)_
- [#33224](https://github.com/oven-sh/bun/pull/33224) `+105/-7` cov=50% — build: fix strip flag downgrade, drop legacy .hash, losslessly shrink bun.ico
- [#30872](https://github.com/oven-sh/bun/pull/30872) `+148/-29` cov=50% — build: don't force -fuse-ld=lld for darwin rust targets
- [#29993](https://github.com/oven-sh/bun/pull/29993) `+234/-5` cov=75% — bundler: honor "module.exports" named export when require(esm) _(also: bundler)_
- [#33305](https://github.com/oven-sh/bun/pull/33305) `+203/-2` cov=100% — node:crypto: support the chacha20-poly1305 cipher _(also: crypto)_
- [#33018](https://github.com/oven-sh/bun/pull/33018) `+139/-9` cov=80% — Fix Windows heap corruption when a socket's data callback closes it and re-enters the event loop _(also: windows)_
- [#33746](https://github.com/oven-sh/bun/pull/33746) `+56/-0` cov=100% — node:zlib: make deflate output independent of write() chunking
- [#32049](https://github.com/oven-sh/bun/pull/32049) `+48/-10` cov=100% — release: enable npm trusted publishing (OIDC) with token fallback _(also: install)_
- [#30366](https://github.com/oven-sh/bun/pull/30366) `+12/-3` cov=100% — release: mirror Docker images to GitHub Container Registry _(also: install)_
- [#33097](https://github.com/oven-sh/bun/pull/33097) `+59/-286` cov=5% — ci: bump test service containers to latest majors (postgres 18, mysql 9, redis 8)
- [#35763](https://github.com/oven-sh/bun/pull/35763) `+67/-5` cov=50% — Bun.serve(http3): lift the 64 KB QPACK prepare_decode cap so a large request header does not abort the connection
- [#35741](https://github.com/oven-sh/bun/pull/35741) `+101/-0` cov=50% — node:quic(h3): build lshpack/lsqpack with 32-bit header lengths so large request headers don't abort the connection
- [#35401](https://github.com/oven-sh/bun/pull/35401) `+125/-38` cov=60% — test_runner: gate event-loop drain and on_exit to node:test, drop BUN_TEST_DRAIN_EVENT_LOOP
- [#32678](https://github.com/oven-sh/bun/pull/32678) `+401/-18` cov=67% — http(h3): reject DATA before final response HEADERS in the HTTP/3 client
- [#36315](https://github.com/oven-sh/bun/pull/36315) `+100/-28` cov=33% — ptr: fix ref-count derives under `cargo test --release --doc`
- [#28932](https://github.com/oven-sh/bun/pull/28932) `+1940/-5` cov=50% — Sign SHASUMS256.txt in the same buildkite run that uploads canary archives
- [#35099](https://github.com/oven-sh/bun/pull/35099) `+130/-5` cov=50% — build: stop `git apply` from silently skipping dep patches with a `diff --git` header
- [#30732](https://github.com/oven-sh/bun/pull/30732) `+193/-9` cov=50% — win: cancel pending cooked tty read when setRawMode(true) follows a synchronous mode bounce _(also: windows)_
- [#33517](https://github.com/oven-sh/bun/pull/33517) `+202/-11` cov=67% — tls: report the Finished messages from getFinished()/getPeerFinished() on TLS 1.3
- [#35673](https://github.com/oven-sh/bun/pull/35673) `+163/-42` cov=67% — HTMLRewriter: dispatch SVG/MathML integration-point siblings to selector handlers _(also: bundler)_
- [#33162](https://github.com/oven-sh/bun/pull/33162) `+81/-8` cov=60% — Upgrade lsquic to 4.6.3 and fix HTTP/3 100-continue on cold connections
- [#36222](https://github.com/oven-sh/bun/pull/36222) `+72/-5` cov=50% — node:crypto: register aes-192-cfb in BoringSSL's cipher lookup table _(also: crypto)_
- [#34739](https://github.com/oven-sh/bun/pull/34739) `+79/-0` cov=50% — mimalloc: fold every thread's theap into the subproc stats aggregate
- [#32129](https://github.com/oven-sh/bun/pull/32129) `+119/-0` cov=50% — Fix AES-GCM output when OPENSSL_ia32cap masks AES-NI but not VAES
- [#28526](https://github.com/oven-sh/bun/pull/28526) `+224/-8` cov=50% — Add AES-CFB8 cipher support
- [#36179](https://github.com/oven-sh/bun/pull/36179) `+73/-507` cov=38% — test/internal: move build-system tests to source-lints/, delete redundant tests
- [#32923](https://github.com/oven-sh/bun/pull/32923) `+214/-0` cov=50% — dns.lookup: return every hosts-file address family instead of only the first line's
- [#33094](https://github.com/oven-sh/bun/pull/33094) `+433/-39` cov=40% — tls: prefer time-valid issuer candidates when building certificate chains
- [#35933](https://github.com/oven-sh/bun/pull/35933) `+511/-0` cov=50% — HTMLRewriter: pass text bytes through unchanged when a text handler only observes
- [#35930](https://github.com/oven-sh/bun/pull/35930) `+425/-0` cov=50% — HTMLRewriter: fix quadratic selector-VM stack scans on hostile nesting
- [#35631](https://github.com/oven-sh/bun/pull/35631) `+176/-0` cov=50% — HTMLRewriter: match attribute selectors with uppercase names
- [#34180](https://github.com/oven-sh/bun/pull/34180) `+91/-0` cov=50% — HTMLRewriter: empty ^= $= ~= attribute selectors match nothing
- [#31983](https://github.com/oven-sh/bun/pull/31983) `+189/-30` cov=50% — uws: make stream-buffer conversion a one-shot ownership transfer
- [#33518](https://github.com/oven-sh/bun/pull/33518) `+197/-2` cov=33% — node:crypto: support SHA-3 digests in sign and verify _(also: jsc-bindings, crypto)_
- [#32525](https://github.com/oven-sh/bun/pull/32525) `+273/-5` cov=33% — crypto: support secp256k1 EC keys _(also: jsc-bindings, crypto)_
- [#34918](https://github.com/oven-sh/bun/pull/34918) `+72/-0` cov=50% — fetch: reject malformed chunk-size tokens instead of reading them as zero
- [#30204](https://github.com/oven-sh/bun/pull/30204) `+1230/-49` cov=38% — Bun.Image: AVIF decode and encode on Linux via dlopen'd libavif _(also: jsc-bindings)_
- [#35762](https://github.com/oven-sh/bun/pull/35762) `+448/-16` cov=33% — node:quic(h3): scope malformed-message failures to one stream instead of CONNECTION_CLOSE
- [#35716](https://github.com/oven-sh/bun/pull/35716) `+208/-2` cov=33% — node:quic h3: reset only the malformed stream on content-length mismatch
- [#35756](https://github.com/oven-sh/bun/pull/35756) `+219/-2` cov=25% — node:quic(h3): reject in-flight requests above the GOAWAY id instead of a clean EOF
- [#36438](https://github.com/oven-sh/bun/pull/36438) `+47/-76` cov=0% — test(valkey): reuse one client across list-operations, run BLPOP/BRPOP in CI
- [#35418](https://github.com/oven-sh/bun/pull/35418) `+218/-121` cov=0% — scripts/ci-slowest-tests: stop charging the parallel phase to the last serial test

### windows — windows-specific code paths, sys/windows
_core ownership · 41 PRs total, 41 above threshold_

- [#34766](https://github.com/oven-sh/bun/pull/34766) `+96/-22` cov=100% — windows: update the per-drive cwd env var in process.chdir _(also: sys)_
- [#34832](https://github.com/oven-sh/bun/pull/34832) `+261/-6` cov=100% — sys(windows): extend DeleteFileBun fallback to handle non-NTFS read-only files _(also: sys)_
- [#34788](https://github.com/oven-sh/bun/pull/34788) `+259/-63` cov=100% — tty(windows): make non-stdin ReadStream#setRawMode use VT raw mode _(also: jsc-bindings, sys)_
- [#34777](https://github.com/oven-sh/bun/pull/34777) `+287/-126` cov=100% — bun:ffi: share dlopen error formatting and load flags with process.dlopen _(also: jsc-bindings, sys)_
- [#35596](https://github.com/oven-sh/bun/pull/35596) `+503/-124` cov=100% — watcher(windows): watch workspace packages outside the project root _(also: sys, install)_
- [#33621](https://github.com/oven-sh/bun/pull/33621) `+335/-239` cov=86% — bun build --compile: skip redundant on-disk copy and mmap the source executable _(also: sys, bundler)_
- [#36107](https://github.com/oven-sh/bun/pull/36107) `+156/-13` cov=100% — Windows: release FileSink keep-alive ref for Bun.file(fd).writer() on a borrowed fd
- [#34199](https://github.com/oven-sh/bun/pull/34199) `+142/-26` cov=100% — Bun.cron: use TimeTrigger for repeating schedules on Windows
- [#36204](https://github.com/oven-sh/bun/pull/36204) `+979/-138` cov=64% — http: fall back to the Windows system proxy when env vars are unset _(also: ci-build, sys)_
- [#34350](https://github.com/oven-sh/bun/pull/34350) `+74/-10` cov=100% — io(windows): don't uv_close the stdin_tty singleton from BaseWindowsPipeWriter
- [#31940](https://github.com/oven-sh/bun/pull/31940) `+424/-76` cov=100% — Fix Windows use-after-free of the pipe reader buffer retained by in-flight libuv reads
- [#34430](https://github.com/oven-sh/bun/pull/34430) `+84/-6` cov=100% — image: load windowscodecs.dll with LOAD_LIBRARY_SEARCH_SYSTEM32 _(also: sys)_
- [#34010](https://github.com/oven-sh/bun/pull/34010) `+117/-2` cov=100% — cli: add --interactive to start the REPL (node compat, fixes test-repl-close EPIPE on Windows)
- [#30560](https://github.com/oven-sh/bun/pull/30560) `+401/-0` cov=100% — repl: pump event loop while waiting for stdin so timers and IPC fire _(also: sys)_
- [#32767](https://github.com/oven-sh/bun/pull/32767) `+110/-6` cov=67% — Harden bun.exe against DLL search-order hijacking on Windows _(also: jsc-bindings, ci-build)_
- [#33029](https://github.com/oven-sh/bun/pull/33029) `+192/-1` cov=67% — install(windows): fall back to FileRenameInformation on non-NTFS volumes _(also: install, sys)_
- [#33714](https://github.com/oven-sh/bun/pull/33714) `+140/-2` cov=100% — usockets: stop reusePort from setting SO_REUSEADDR on Windows TCP listeners
- [#33992](https://github.com/oven-sh/bun/pull/33992) `+1098/-2` cov=64% — Add Bun.file().lock() and FileLock _(also: sys, jsc-bindings)_
- [#35942](https://github.com/oven-sh/bun/pull/35942) `+42/-9` cov=100% — node:os: fix setPriority silently succeeding for bogus pid on Windows
- [#36340](https://github.com/oven-sh/bun/pull/36340) `+177/-43` cov=100% — paths: size the thread-local join output buffers to MAX_PATH_BYTES on Windows
- [#36002](https://github.com/oven-sh/bun/pull/36002) `+74/-39` cov=100% — node:path: size win32.resolve device buffer to input; throw errors instead of returning them
- [#34584](https://github.com/oven-sh/bun/pull/34584) `+184/-2` cov=100% — node:path: use Unicode toLowerCase for win32.relative case-insensitive compare
- [#34582](https://github.com/oven-sh/bun/pull/34582) `+71/-38` cov=100% — node:path: dispatch win32.toNamespacedPath on native string width (fix short non-ASCII guard)
- [#33715](https://github.com/oven-sh/bun/pull/33715) `+115/-4` cov=100% — Bun.write: fix file-to-file copy resolving 0 bytes on Windows and macOS overwrite
- [#32017](https://github.com/oven-sh/bun/pull/32017) `+103/-3` cov=100% — Fix resolver panic on Windows drive-letter specifiers on POSIX _(also: resolver, crash-handler)_
- [#35865](https://github.com/oven-sh/bun/pull/35865) `+146/-16` cov=100% — node:zlib: feed a 2^32-byte chunk to the native writer in u32 windows
- [#35859](https://github.com/oven-sh/bun/pull/35859) `+141/-19` cov=100% — Bun.gzipSync/deflateSync: feed >=4 GiB inputs to zlib in u32 windows instead of wrapping to 0
- [#35427](https://github.com/oven-sh/bun/pull/35427) `+72/-22` cov=100% — test(spawn): speed up spawn-noread-leak.test.ts (27s -> 2s on Windows arm64) _(also: spawn)_
- [#33015](https://github.com/oven-sh/bun/pull/33015) `+120/-11` cov=100% — fix(windows): segfault in uv__wake_all_loops after system resume
- [#36400](https://github.com/oven-sh/bun/pull/36400) `+925/-2` cov=50% — windows: exploratory I/O Ring backend for async fs.read/fs.write (measured; not a win) _(also: node-fs, sys)_
- [#34905](https://github.com/oven-sh/bun/pull/34905) `+225/-25` cov=75% — shell: expand $RANDOM, $UID, $PPID, $SECONDS, $IFS, $OSTYPE and friends _(also: sys, shell)_
- [#30891](https://github.com/oven-sh/bun/pull/30891) `+616/-7` cov=80% — update -i: restore cursor on Ctrl+C (Windows)
- [#32514](https://github.com/oven-sh/bun/pull/32514) `+85/-17` cov=50% — Open the browser via cmd.exe on Windows
- [#34680](https://github.com/oven-sh/bun/pull/34680) `+96/-0` cov=33% — test: quarantine test-http-client-leaky-with-double-response on Windows, add deterministic twin
- [#35260](https://github.com/oven-sh/bun/pull/35260) `+233/-27` cov=0% — node:url: honor the {windows} option in fileURLToPath and pathToFileURL
- [#34449](https://github.com/oven-sh/bun/pull/34449) `+80/-30` cov=0% — test(es-module-lexer): bound per-child timeout and surface stall phase on Windows _(also: js-parser)_
- [#33988](https://github.com/oven-sh/bun/pull/33988) `+11/-4` cov=0% — test(fetch): widen fetch-leak RSS thresholds for macOS/Windows arm64
- [#30122](https://github.com/oven-sh/bun/pull/30122) `+237/-0` cov=0% — test(fs.watch): regression guard for per-VM PathWatcherManager on Windows _(also: node-fs)_
- [#29662](https://github.com/oven-sh/bun/pull/29662) `+37/-21` cov=0% — test(bake/stress): skip 'crash #18910' on Windows and under ASAN/debug _(also: crash-handler)_
- [#29638](https://github.com/oven-sh/bun/pull/29638) `+910/-7` cov=0% — debug-adapter: fix `spawn EINVAL` on Windows when bun resolves to .cmd _(also: spawn)_
- [#29106](https://github.com/oven-sh/bun/pull/29106) `+432/-14` cov=0% — webview: throw clear not-implemented on Windows for chrome backend

### yaml — YAML parser
_core ownership · 4 PRs total, 4 above threshold_

- [#34887](https://github.com/oven-sh/bun/pull/34887) `+52/-3` cov=100% — yaml: own the property-name anchor string so it survives GC during stringify
- [#34855](https://github.com/oven-sh/bun/pull/34855) `+428/-48` cov=100% — yaml: resolve self-referential anchors so cyclic objects round-trip
- [#34851](https://github.com/oven-sh/bun/pull/34851) `+80/-31` cov=100% — yaml: keep signed hex/octal as strings, fold CRLF as one break in quoted scalars, preserve merge-key source order
- [#32385](https://github.com/oven-sh/bun/pull/32385) `+91/-24` cov=100% — yaml: fold merge-key property budget into alias-expansion budget

### toml — TOML parser, bunfig
_core ownership · 9 PRs total, 9 above threshold_

- [#36473](https://github.com/oven-sh/bun/pull/36473) `+28/-7` cov=100% — toml: cap dotted-key/header path length at 4096 segments
- [#36466](https://github.com/oven-sh/bun/pull/36466) `+308/-66` cov=100% — toml: actionable diagnostics for unquoted values and Windows-path backslashes _(also: windows)_
- [#34004](https://github.com/oven-sh/bun/pull/34004) `+54/-7` cov=100% — toml: parse nested array literals with adjacent brackets
- [#31256](https://github.com/oven-sh/bun/pull/31256) `+184/-41` cov=100% — toml: restrict bare keys and values to the TOML 1.0.0 spec
- [#31253](https://github.com/oven-sh/bun/pull/31253) `+106/-31` cov=100% — toml: reject bare identifiers at value position
- [#30314](https://github.com/oven-sh/bun/pull/30314) `+280/-21` cov=100% — Support CA store selection in bunfig.toml
- [#28727](https://github.com/oven-sh/bun/pull/28727) `+708/-25` cov=86% — Add system-wide bunfig.toml support
- [#28682](https://github.com/oven-sh/bun/pull/28682) `+179/-23` cov=100% — Fix TOML multi-line string trimming
- [#30826](https://github.com/oven-sh/bun/pull/30826) `+52/-4` cov=100% — js_parser/lexer: saturate `\u{...}` hex multiply to avoid i64 overflow _(also: js-parser)_

### js-parser — js_parser, js_lexer, js_printer, ast, transpiler
_strong familiarity · 111 PRs total, 101 above threshold_

- [#33386](https://github.com/oven-sh/bun/pull/33386) `+365/-31` cov=100% — js_parser: key exports.eliminate/replace on the exported name _(also: bundler)_
- [#32790](https://github.com/oven-sh/bun/pull/32790) `+904/-56` cov=100% — Bun.Transpiler: add variables and functions to the replMode result object
- [#35557](https://github.com/oven-sh/bun/pull/35557) `+162/-14` cov=80% — Bun.Transpiler: default autoImportJSX to true for the automatic runtime _(also: bundler)_
- [#36228](https://github.com/oven-sh/bun/pull/36228) `+79/-15` cov=100% — js_parser: validate function statement names for await/yield _(also: bundler)_
- [#35625](https://github.com/oven-sh/bun/pull/35625) `+44/-16` cov=100% — js_parser: stop cascading errors after "await" in a non-async function _(also: bundler)_
- [#34251](https://github.com/oven-sh/bun/pull/34251) `+118/-13` cov=100% — parser(ts): keep "export {}" ESM marker when all specifiers are type-only _(also: bundler)_
- [#34016](https://github.com/oven-sh/bun/pull/34016) `+17/-0` cov=100% — fix(transpiler): skip leading hashbang in scanImports _(also: bundler)_
- [#34015](https://github.com/oven-sh/bun/pull/34015) `+21/-1` cov=100% — fix(transpiler): scanImports drops dynamic import() with non-ASCII specifier _(also: bundler)_
- [#34014](https://github.com/oven-sh/bun/pull/34014) `+50/-4` cov=100% — Report require.resolve() edges in Bun.Transpiler.scanImports() _(also: bundler)_
- [#33378](https://github.com/oven-sh/bun/pull/33378) `+273/-65` cov=100% — js_parser: apply exports.eliminate/replace to function and class declarations _(also: bundler)_
- [#33376](https://github.com/oven-sh/bun/pull/33376) `+58/-9` cov=100% — js_parser: fix panic when exports.eliminate removes a hoistable export _(also: bundler, crash-handler)_
- [#32375](https://github.com/oven-sh/bun/pull/32375) `+109/-108` cov=100% — Bun.Transpiler: stop deep-cloning macro_map/replace_exports per transform() call _(also: bundler, jsc-bindings)_
- [#36122](https://github.com/oven-sh/bun/pull/36122) `+286/-39` cov=92% — js_printer: guard undefined/NaN/Infinity identifiers against local shadows _(also: bundler, jsc-bindings)_
- [#34252](https://github.com/oven-sh/bun/pull/34252) `+235/-11` cov=88% — js_parser: disambiguate `a ? (b) : c => d` between ternary and arrow return type _(also: bundler)_
- [#30085](https://github.com/oven-sh/bun/pull/30085) `+27/-1` cov=100% — fix(transpiler): fold `import.meta?.main` through the optional chain _(also: bundler)_
- [#28714](https://github.com/oven-sh/bun/pull/28714) `+327/-52` cov=56% — fix(transpiler): parse minifySyntax and minifyIdentifiers as top-level Bun.Transpiler options _(also: bundler)_
- [#33807](https://github.com/oven-sh/bun/pull/33807) `+210/-20` cov=100% — parser: .mjs/"type":"module" is authoritative over module/exports identifier refs _(also: jsc-bindings, bundler)_
- [#36124](https://github.com/oven-sh/bun/pull/36124) `+125/-9` cov=100% — js_printer: don't emit bare undefined/NaN/Infinity for synthesized values when the file shadows them _(also: bundler)_
- [#36120](https://github.com/oven-sh/bun/pull/36120) `+172/-24` cov=100% — js_printer: preserve __proto__ key vs shorthand form in object literals _(also: bundler)_
- [#34970](https://github.com/oven-sh/bun/pull/34970) `+125/-28` cov=100% — Bun.Transpiler: coerce loader before capturing the code buffer
- [#32388](https://github.com/oven-sh/bun/pull/32388) `+78/-1` cov=100% — JSTranspiler: move TransformOptions into Transpiler::init instead of cloning
- [#32384](https://github.com/oven-sh/bun/pull/32384) `+79/-22` cov=100% — Bun.Transpiler: don't mi_heap_new() per instance
- [#32370](https://github.com/oven-sh/bun/pull/32370) `+72/-0` cov=100% — Bun.Transpiler: release output_code when async transform() rejects
- [#35960](https://github.com/oven-sh/bun/pull/35960) `+139/-5` cov=80% — js_parser: preserve Annex B.3.3 block-level function hoist in runtime transpiler _(also: bundler)_
- [#35797](https://github.com/oven-sh/bun/pull/35797) `+42/-116` cov=100% — parser: remove unreachable module.exports=require() -> export* rewrite _(also: bundler)_
- [#35648](https://github.com/oven-sh/bun/pull/35648) `+115/-18` cov=100% — transpiler: preserve class TDZ by not hoisting declarations in the runtime path _(also: bundler)_
- [#34721](https://github.com/oven-sh/bun/pull/34721) `+50/-1` cov=100% — transpiler cache: include module_type in features hash _(also: jsc-bindings)_
- [#31758](https://github.com/oven-sh/bun/pull/31758) `+63/-2` cov=100% — transpiler cache: don't replay plain-run entries under bun test _(also: jsc-bindings, test-runner)_
- [#36134](https://github.com/oven-sh/bun/pull/36134) `+33/-1` cov=100% — js_printer: parenthesize missing-import void 0 on LHS of ** _(also: bundler)_
- [#35739](https://github.com/oven-sh/bun/pull/35739) `+145/-7` cov=100% — js_printer: don't rewrite require('bun') to globalThis.Bun at runtime _(also: bundler, jsc-bindings)_
- [#35358](https://github.com/oven-sh/bun/pull/35358) `+30/-31` cov=100% — js_printer: replace per-site BackRef<Symbol> with detached &'a Symbol accessors
- [#33490](https://github.com/oven-sh/bun/pull/33490) `+178/-41` cov=100% — ast: stop the block store invalidating the nodes it hands out
- [#32297](https://github.com/oven-sh/bun/pull/32297) `+33/-2` cov=100% — fix(parser): encoding-aware compare for UTF-16 object key in ({k:v}).k folding _(also: bundler)_
- [#31863](https://github.com/oven-sh/bun/pull/31863) `+60/-11` cov=100% — Replace redundant unsafe blocks with safe const std equivalents _(also: crash-handler)_
- [#30936](https://github.com/oven-sh/bun/pull/30936) `+136/-3` cov=100% — parser: preserve TDZ for const declared in switch case _(also: bundler, jsc-bindings)_
- [#35638](https://github.com/oven-sh/bun/pull/35638) `+162/-7` cov=100% — parser: treat top-level return as a CommonJS hint _(also: bundler, jsc-bindings)_
- [#35593](https://github.com/oven-sh/bun/pull/35593) `+170/-20` cov=100% — js_parser: don't fold wrappers that expose anonymous class/fn to NamedEvaluation _(also: bundler)_
- [#32188](https://github.com/oven-sh/bun/pull/32188) `+303/-53` cov=100% — Check strict-mode reserved words at declaration sites in implicitly strict files _(also: bundler)_
- [#31858](https://github.com/oven-sh/bun/pull/31858) `+50/-3` cov=100% — Parse computed string literal enum member names _(also: bundler)_
- [#31813](https://github.com/oven-sh/bun/pull/31813) `+197/-11` cov=100% — Keep required parens around a new expression callee _(also: bundler)_
- [#35969](https://github.com/oven-sh/bun/pull/35969) `+576/-89` cov=88% — js_parser: stop rejecting valid sloppy-mode CommonJS _(also: bundler)_
- [#35968](https://github.com/oven-sh/bun/pull/35968) `+248/-12` cov=90% — js_parser: raise strict-mode errors for legacy octal, for-in var init, and if/label function statements _(also: bundler, jsc-bindings)_
- [#35162](https://github.com/oven-sh/bun/pull/35162) `+116/-6` cov=83% — parser: keep nested macro imports as real imports inside the macro runtime _(also: bundler, jsc-bindings)_
- [#34617](https://github.com/oven-sh/bun/pull/34617) `+233/-21` cov=67% — transpiler: mangle reserved-word JSON/TOML top-level keys to valid identifiers _(also: bundler, toml)_
- [#30206](https://github.com/oven-sh/bun/pull/30206) `+420/-14` cov=88% — fix(transpiler): keep numeric binary expressions when fold would inflate output _(also: bundler)_
- [#33447](https://github.com/oven-sh/bun/pull/33447) `+226/-45` cov=100% — Parenthesize `require.main === module` per its surrounding precedence _(also: bundler, jsc-bindings)_
- [#32177](https://github.com/oven-sh/bun/pull/32177) `+715/-56` cov=100% — Apply implicit strict mode to files forced to ESM by .mjs or package.json type module _(also: bundler, jsc-bindings)_
- [#35961](https://github.com/oven-sh/bun/pull/35961) `+32/-3` cov=100% — bundler: fold import.meta.filename for cjs output; emit direct-eval build note _(also: bundler)_
- [#35959](https://github.com/oven-sh/bun/pull/35959) `+83/-1` cov=100% — bundler: error on 'with' statements that would land in strict-mode ESM output _(also: bundler)_
- [#35476](https://github.com/oven-sh/bun/pull/35476) `+340/-3` cov=100% — bundler: polyfill the process and Buffer globals for --target browser _(also: bundler)_
- [#34089](https://github.com/oven-sh/bun/pull/34089) `+359/-14` cov=80% — parser: fold const values into macro arguments regardless of statement position _(also: bundler)_
- [#28693](https://github.com/oven-sh/bun/pull/28693) `+169/-33` cov=100% — Inline env vars through optional chaining and globalThis in bundler _(also: bundler)_
- [#36125](https://github.com/oven-sh/bun/pull/36125) `+123/-14` cov=100% — bun test: keep injecting jest globals alongside a partial bun:test import _(also: jsc-bindings, test-runner)_
- [#35955](https://github.com/oven-sh/bun/pull/35955) `+177/-6` cov=100% — bundler: pin CJS module-scope names when direct eval is present _(also: bundler)_
- [#35665](https://github.com/oven-sh/bun/pull/35665) `+125/-1` cov=100% — bundler: keep CJS wrapped when module.exports escapes as a value _(also: bundler)_
- [#35651](https://github.com/oven-sh/bun/pull/35651) `+74/-1` cov=100% — bundler: inject __dirname/__filename into CJS wrappers that use direct eval _(also: bundler)_
- [#32197](https://github.com/oven-sh/bun/pull/32197) `+80/-0` cov=100% — Error on unbound strict-mode reserved words when bundling to ESM _(also: bundler)_
- [#28692](https://github.com/oven-sh/bun/pull/28692) `+162/-0` cov=100% — Lower import.meta.env to process.env when bundling _(also: bundler)_
- [#36143](https://github.com/oven-sh/bun/pull/36143) `+212/-82` cov=75% — js_parser: fix TS import-equals multi-pass re-emitting trailing statements _(also: bundler)_
- [#35784](https://github.com/oven-sh/bun/pull/35784) `+235/-6` cov=75% — js_parser: reject duplicate function declarations at ESM module scope _(also: bundler)_
- [#35684](https://github.com/oven-sh/bun/pull/35684) `+286/-0` cov=100% — bundler: hoist `var` for sloppy-mode implicit global assignment in ESM output _(also: bundler)_
- [#35575](https://github.com/oven-sh/bun/pull/35575) `+125/-1` cov=100% — bundler: seed reserved names with globalThis/Error/Infinity/NaN so locals can't capture printer literals _(also: bundler)_
- [#34361](https://github.com/oven-sh/bun/pull/34361) `+64/-0` cov=100% — Avoid "arguments" and "eval" as binding names in strict-mode bundle output
- [#33905](https://github.com/oven-sh/bun/pull/33905) `+73/-9` cov=100% — test runner: keep plugin onResolve namespace in cached module records under --isolate _(also: test-runner)_
- [#32655](https://github.com/oven-sh/bun/pull/32655) `+185/-3` cov=100% — Convert top-level class statements to var declarations when bundling _(also: bundler)_
- [#30673](https://github.com/oven-sh/bun/pull/30673) `+98/-0` cov=100% — Fix missing space between preceding identifier and rewritten globalThis.Bun under --minify-whitespace _(also: bundler)_
- [#31677](https://github.com/oven-sh/bun/pull/31677) `+1567/-133` cov=81% — Implement source phase imports (TC39 Stage 3) _(also: bundler, jsc-bindings)_
- [#35967](https://github.com/oven-sh/bun/pull/35967) `+38/-7` cov=100% — bundler: inline module.filename/module.path to match __filename/__dirname _(also: bundler)_
- [#35009](https://github.com/oven-sh/bun/pull/35009) `+38/-0` cov=100% — Fix `import.meta.hot?.accept()` throwing in dev server
- [#30545](https://github.com/oven-sh/bun/pull/30545) `+292/-29` cov=100% — Support tagged template literals in macros _(also: bundler)_
- [#29201](https://github.com/oven-sh/bun/pull/29201) `+301/-6` cov=100% — Parse and lower `accessor` fields under experimentalDecorators
- [#35306](https://github.com/oven-sh/bun/pull/35306) `+139/-69` cov=80% — printer: decode ill-formed UTF-8 as U+FFFD when quoting byte strings _(also: bundler)_
- [#35699](https://github.com/oven-sh/bun/pull/35699) `+821/-30` cov=80% — bundler: bundle template-literal require()/import() via glob _(also: bundler)_
- [#35548](https://github.com/oven-sh/bun/pull/35548) `+250/-17` cov=67% — js_parser: tighten when a macro result may enter const_values _(also: bundler)_
- [#35299](https://github.com/oven-sh/bun/pull/35299) `+198/-16` cov=67% — Bun.serve: Date/Content-Length on parser-tier 4xx/5xx; 414 for oversize URI; 501 for unknown methods
- [#35958](https://github.com/oven-sh/bun/pull/35958) `+234/-1` cov=86% — bundler: hoist object/array --define values to a shared var _(also: bundler)_
- [#29246](https://github.com/oven-sh/bun/pull/29246) `+755/-37` cov=88% — bundler: let DCE drop unreachable top-level await before rejecting CJS _(also: bundler)_
- [#34560](https://github.com/oven-sh/bun/pull/34560) `+240/-24` cov=83% — bundler: match process.env.X case-insensitively for --env inline on Windows _(also: bundler, windows)_
- [#36334](https://github.com/oven-sh/bun/pull/36334) `+277/-10` cov=80% — runtime + --no-bundle: implement base64/dataurl loaders _(also: bundler, resolver)_
- [#35688](https://github.com/oven-sh/bun/pull/35688) `+635/-1` cov=62% — bundler: resolve require("bindings")(name) to a static .node import _(also: napi, bundler)_
- [#35307](https://github.com/oven-sh/bun/pull/35307) `+401/-57` cov=88% — bundler: make --keep-names preserve .name via __name() runtime calls _(also: bundler)_
- [#35642](https://github.com/oven-sh/bun/pull/35642) `+237/-1` cov=83% — bundler: resolve require('bindings')(name) to the built .node file _(also: bundler, resolver)_
- [#32592](https://github.com/oven-sh/bun/pull/32592) `+210/-13` cov=83% — Fix inspector breakpoints landing one line early with --inspect-brk
- [#35471](https://github.com/oven-sh/bun/pull/35471) `+367/-20` cov=60% — transpiler: emit decorator metadata for imports via the module namespace _(also: bundler)_
- [#31405](https://github.com/oven-sh/bun/pull/31405) `+494/-12` cov=83% — Lower private names referenced by class static blocks during decorator lowering _(also: bundler)_
- [#31930](https://github.com/oven-sh/bun/pull/31930) `+301/-54` cov=75% — Give decorator lowering temporaries file-unique names _(also: bundler)_
- [#32206](https://github.com/oven-sh/bun/pull/32206) `+771/-2` cov=78% — node:module: implement stripTypeScriptTypes _(also: jsc-bindings)_
- [#34933](https://github.com/oven-sh/bun/pull/34933) `+109/-8` cov=50% — transpiler: preserve TDZ for top-level class declarations referenced earlier in the file _(also: bundler)_
- [#35659](https://github.com/oven-sh/bun/pull/35659) `+211/-18` cov=71% — bundler: downgrade unresolvable require() in catch handler to runtime throw _(also: bundler)_
- [#36313](https://github.com/oven-sh/bun/pull/36313) `+127/-2` cov=50% — js_parser: don't inline single-use anonymous fn/arrow/class initializers _(also: bundler)_
- [#35574](https://github.com/oven-sh/bun/pull/35574) `+72/-14` cov=50% — js_parser: keep all macro-object properties when the destructuring pattern reorders keys _(also: bundler)_
- [#35537](https://github.com/oven-sh/bun/pull/35537) `+248/-361` cov=50% — js_parser: keep [[Define]] semantics for decorated class fields _(also: bundler)_
- [#31244](https://github.com/oven-sh/bun/pull/31244) `+445/-20` cov=67% — Implement dynamic `import.defer()` (TC39 Stage 3) _(also: jsc-bindings, bundler)_
- [#35708](https://github.com/oven-sh/bun/pull/35708) `+340/-97` cov=50% — js_parser: lower undecorated auto-accessors to a native #-private storage field _(also: bundler)_
- [#34932](https://github.com/oven-sh/bun/pull/34932) `+49/-5` cov=50% — js_parser: keep anonymous `export default function` anonymous so `.name` is "default" _(also: bundler)_
- [#31803](https://github.com/oven-sh/bun/pull/31803) `+135/-122` cov=50% — transpiler cache: give the Rust line its own .pile2 filename namespace _(also: bundler, jsc-bindings)_
- [#36297](https://github.com/oven-sh/bun/pull/36297) `+648/-8` cov=67% — bun:test: hoist jest.mock/vi.mock/mock.module above imports _(also: jsc-bindings, test-runner)_
- [#34985](https://github.com/oven-sh/bun/pull/34985) `+170/-7` cov=67% — bundler: make --drop match bound identifiers (imports/locals), not just free globals _(also: bundler)_
- [#31076](https://github.com/oven-sh/bun/pull/31076) `+76/-25` cov=67% — Print integers in shorter scientific form when possible _(also: bundler)_
- [#29749](https://github.com/oven-sh/bun/pull/29749) `+452/-54` cov=67% — fix(bake): preserve live bindings through `export * from` in HMR _(also: jsc-bindings)_
- [#31926](https://github.com/oven-sh/bun/pull/31926) `+555/-61` cov=67% — Lower accessor-only classes in place instead of relocating static elements _(also: bundler)_

### napi — N-API / Node-API
_strong familiarity · 21 PRs total, 18 above threshold_

- [#36095](https://github.com/oven-sh/bun/pull/36095) `+153/-8` cov=100% — napi: guard string creators and buffer accessors against pending VM exception _(also: jsc-bindings)_
- [#36093](https://github.com/oven-sh/bun/pull/36093) `+148/-8` cov=100% — napi: tolerate pending VM exception in ArrayBuffer/typed-array info accessors (debug/asan abort) _(also: jsc-bindings)_
- [#36091](https://github.com/oven-sh/bun/pull/36091) `+166/-37` cov=100% — napi: tolerate pending VM exception in napi_create_string_* (debug/asan abort) _(also: jsc-bindings)_
- [#36090](https://github.com/oven-sh/bun/pull/36090) `+85/-2` cov=100% — napi: enqueue external ArrayBuffer finalize_cb instead of running it inside detach _(also: jsc-bindings)_
- [#34132](https://github.com/oven-sh/bun/pull/34132) `+190/-25` cov=100% — napi: validate typedarray alignment/length before JSC, type-check view info APIs _(also: jsc-bindings)_
- [#32263](https://github.com/oven-sh/bun/pull/32263) `+90/-3` cov=100% — napi: propagate Proxy trap exceptions from napi_get_all_property_names descriptor filter _(also: jsc-bindings)_
- [#32259](https://github.com/oven-sh/bun/pull/32259) `+55/-0` cov=100% — napi: write copied=false in node_api_create_external_string_utf16 _(also: jsc-bindings)_
- [#30543](https://github.com/oven-sh/bun/pull/30543) `+63/-8` cov=100% — napi: pass NULL js_callback to call_js_cb when no func was provided
- [#36089](https://github.com/oven-sh/bun/pull/36089) `+125/-1` cov=80% — napi: allow napi_create_reference on primitives for modules declaring NAPI_VERSION >= 10 _(also: jsc-bindings)_
- [#34156](https://github.com/oven-sh/bun/pull/34156) `+38/-6` cov=100% — napi: return napi_generic_failure + NULL from napi_get_uv_event_loop on posix
- [#35618](https://github.com/oven-sh/bun/pull/35618) `+155/-1` cov=75% — napi(windows): rebind node.exe imports to the host process in process.dlopen _(also: jsc-bindings, windows)_
- [#34754](https://github.com/oven-sh/bun/pull/34754) `+73/-1` cov=75% — napi: pass module.exports (not the module) to napi_module_register's init callback _(also: jsc-bindings)_
- [#34136](https://github.com/oven-sh/bun/pull/34136) `+228/-3` cov=67% — napi: wait for napi_remove_async_cleanup_hook before tearing down the env _(also: jsc-bindings)_
- [#34664](https://github.com/oven-sh/bun/pull/34664) `+185/-4` cov=50% — napi: keep exceptions thrown by JS during env cleanup visible to the addon _(also: jsc-bindings)_
- [#36210](https://github.com/oven-sh/bun/pull/36210) `+151/-37` cov=50% — test(napi): extend the direct-compile fast path to Windows _(also: windows)_
- [#34750](https://github.com/oven-sh/bun/pull/34750) `+117/-0` cov=50% — napi: check exceptions between NapiClass::create and defineOwnProperty _(also: jsc-bindings)_
- [#32911](https://github.com/oven-sh/bun/pull/32911) `+177/-17` cov=50% — napi: don't require addon code to satisfy JSC's exception-check discipline _(also: jsc-bindings)_
- [#32277](https://github.com/oven-sh/bun/pull/32277) `+218/-2` cov=50% — napi: capture Ref<NapiEnv> in node_api_create_external_string_* finalizers _(also: jsc-bindings)_

### bundler — bundler, Bun.build, --compile
_strong familiarity · 169 PRs total, 153 above threshold_

- [#34190](https://github.com/oven-sh/bun/pull/34190) `+579/-48` cov=88% — bundler: route builtins through onResolve for target 'bun'; add `external: false`
- [#29291](https://github.com/oven-sh/bun/pull/29291) `+196/-40` cov=83% — Support `--bytecode` with `--format=esm` without `--compile`
- [#30539](https://github.com/oven-sh/bun/pull/30539) `+1020/-67` cov=82% — bundler: chain inline input sourcemaps through to output _(also: ci-build, js-parser)_
- [#36327](https://github.com/oven-sh/bun/pull/36327) `+343/-75` cov=78% — bundler: implement dataurl and base64 loaders _(also: js-parser)_
- [#35658](https://github.com/oven-sh/bun/pull/35658) `+213/-19` cov=100% — Bun.Transpiler: drop imports whose bindings are all DCE'd in TypeScript _(also: js-parser, jsc-bindings)_
- [#32951](https://github.com/oven-sh/bun/pull/32951) `+77/-1` cov=100% — transpiler: expose reactFastRefresh on Bun.Transpiler _(also: js-parser)_
- [#32473](https://github.com/oven-sh/bun/pull/32473) `+1476/-110` cov=75% — bundler: chain external input sourcemaps and thread chains through the dev server _(also: ci-build, js-parser)_
- [#35674](https://github.com/oven-sh/bun/pull/35674) `+123/-12` cov=100% — bundler: emit .mjs for ESM output when --target node _(also: napi)_
- [#35472](https://github.com/oven-sh/bun/pull/35472) `+290/-2` cov=100% — bundler: tree-shake the automatic JSX runtime import when all JSX is dead _(also: js-parser)_
- [#35920](https://github.com/oven-sh/bun/pull/35920) `+118/-13` cov=100% — Bun.Transpiler: encode string source as WTF-8 so unpaired surrogates survive _(also: js-parser)_
- [#35312](https://github.com/oven-sh/bun/pull/35312) `+104/-30` cov=100% — bundler: release arena-allocated Transpiler/AST store when Bun.build option setup fails _(also: js-parser)_
- [#36190](https://github.com/oven-sh/bun/pull/36190) `+79/-4` cov=100% — bundler: report the output-format reason when top-level await is rejected for cjs/iife _(also: js-parser)_
- [#34934](https://github.com/oven-sh/bun/pull/34934) `+92/-47` cov=100% — bundler: keep const/class initializers inside the __esm wrapper _(also: js-parser)_
- [#33059](https://github.com/oven-sh/bun/pull/33059) `+112/-16` cov=100% — bundler: emit an empty object for modules disabled via the browser field _(also: js-parser, resolver)_
- [#34557](https://github.com/oven-sh/bun/pull/34557) `+69/-45` cov=100% — bundler: emit posix-relative paths in the HTML-import manifest on Windows _(also: windows)_
- [#35473](https://github.com/oven-sh/bun/pull/35473) `+476/-69` cov=93% — bundler: hoist "use client"/"use server" directives to the top of output _(also: js-parser, jsc-bindings)_
- [#30440](https://github.com/oven-sh/bun/pull/30440) `+86/-0` cov=100% — test: add regression guard for hot-reload + Bun.build (#30436)
- [#32357](https://github.com/oven-sh/bun/pull/32357) `+66/-4` cov=67% — sys: map getcwd ENOENT to CurrentWorkingDirectoryUnlinked _(also: resolver, sys)_
- [#32851](https://github.com/oven-sh/bun/pull/32851) `+312/-74` cov=100% — bun build --compile: read NODE_ENV at runtime, set argv[0] to the executable path
- [#29066](https://github.com/oven-sh/bun/pull/29066) `+340/-41` cov=100% — Use virtual $bunfs path for __dirname/__filename in --compile _(also: js-parser)_
- [#28923](https://github.com/oven-sh/bun/pull/28923) `+529/-32` cov=82% — Respect file loader for small CSS assets instead of inlining _(also: js-parser)_
- [#34330](https://github.com/oven-sh/bun/pull/34330) `+212/-24` cov=40% — build --compile: resolve cross-compile cache via full BUN_INSTALL/XDG chain _(also: sys)_
- [#31147](https://github.com/oven-sh/bun/pull/31147) `+147/-1` cov=100% — bundler: make optimizeImports tree-shake mixed barrels
- [#35309](https://github.com/oven-sh/bun/pull/35309) `+210/-273` cov=86% — bundler: reject --define values that are not a JSON literal or identifier
- [#35663](https://github.com/oven-sh/bun/pull/35663) `+103/-15` cov=100% — bundler: register every top-level symbol before renaming nested scopes
- [#35662](https://github.com/oven-sh/bun/pull/35662) `+75/-2` cov=100% — bundler: lower import.meta.require for non-bun targets _(also: js-parser)_
- [#35636](https://github.com/oven-sh/bun/pull/35636) `+91/-0` cov=100% — bundler: rewrite Bun.env / import.meta.env to process.env for --target=node
- [#34558](https://github.com/oven-sh/bun/pull/34558) `+155/-52` cov=100% — bundler: canonicalize the asset source directory for [dir] only when string relativization falls outside root
- [#34541](https://github.com/oven-sh/bun/pull/34541) `+154/-135` cov=100% — bundler: drive tree-shaking and code-splitting reachability off explicit worklists
- [#33881](https://github.com/oven-sh/bun/pull/33881) `+150/-5` cov=100% — bundler: allocate wrapper_ref for CommonJS modules with no non-hoistable statements _(also: js-parser)_
- [#33862](https://github.com/oven-sh/bun/pull/33862) `+117/-17` cov=100% — bundler: propagate known_target so a hashbang-bun entry does not split the dedup graph
- [#33855](https://github.com/oven-sh/bun/pull/33855) `+65/-0` cov=100% — bun build --production: override ambient NODE_ENV instead of defaulting
- [#33337](https://github.com/oven-sh/bun/pull/33337) `+250/-87` cov=100% — bundler: keep wrapped ESM dependencies in their import position
- [#36384](https://github.com/oven-sh/bun/pull/36384) `+111/-2` cov=100% — bun build --compile: only write .map sidecar for --sourcemap=external
- [#35860](https://github.com/oven-sh/bun/pull/35860) `+88/-11` cov=100% — Bun.build: report an error for HTML rooted script src paths >= 4096 bytes instead of aborting _(also: resolver, ci-build)_
- [#35853](https://github.com/oven-sh/bun/pull/35853) `+127/-4` cov=100% — bundler: surface ENAMETOOLONG for oversized onResolve paths instead of panicking
- [#35724](https://github.com/oven-sh/bun/pull/35724) `+102/-4` cov=100% — bundler: re-exporting a missing CJS-to-ESM named import no longer emits an invalid ref
- [#35722](https://github.com/oven-sh/bun/pull/35722) `+134/-5` cov=100% — bundler: skip __toESM for unwrapped require() that lands on a CJS wrapper _(also: js-parser)_
- [#35696](https://github.com/oven-sh/bun/pull/35696) `+189/-2` cov=100% — bundler: keep CJS wrapper when a cjs-to-esm converted file is import()-ed
- [#35692](https://github.com/oven-sh/bun/pull/35692) `+74/-2` cov=100% — bundler: no spurious `with { type: ... }` on external hoisted from `module.exports = require(...)`
- [#35660](https://github.com/oven-sh/bun/pull/35660) `+80/-12` cov=100% — bundler: keep the symlink spelling of entry-point output paths
- [#35644](https://github.com/oven-sh/bun/pull/35644) `+268/-9` cov=100% — bun build --no-bundle: write output files when --outdir is set
- [#35633](https://github.com/oven-sh/bun/pull/35633) `+138/-0` cov=100% — bun build: install a file watcher for --no-bundle --watch _(also: jsc-bindings, install)_
- [#35361](https://github.com/oven-sh/bun/pull/35361) `+188/-248` cov=100% — bundler: replace *mut Self / detach_lifetime borrowck workarounds with disjoint field borrows (6 sites) _(also: js-parser)_
- [#33588](https://github.com/oven-sh/bun/pull/33588) `+95/-19` cov=100% — bundler: fix BuildArtifact.sourcemap pointing at wrong output for multi-entry builds
- [#32881](https://github.com/oven-sh/bun/pull/32881) `+11/-8` cov=100% — bundler: compute content hash for sourcemap OutputFiles
- [#32347](https://github.com/oven-sh/bun/pull/32347) `+49/-2` cov=100% — Bun.build: restore Zig error names in root directory open failures _(also: ci-build)_
- [#30884](https://github.com/oven-sh/bun/pull/30884) `+56/-14` cov=100% — bun build: honor --outfile directory when --sourcemap is set _(also: ci-build)_
- [#30623](https://github.com/oven-sh/bun/pull/30623) `+138/-3` cov=100% — bundler: log InvalidDataURL resolver failures instead of panicking _(also: resolver)_
- [#30540](https://github.com/oven-sh/bun/pull/30540) `+847/-46` cov=75% — transpiler: emit v3 source map from transformSync / transform _(also: js-parser)_
- [#36326](https://github.com/oven-sh/bun/pull/36326) `+89/-20` cov=100% — bundler: stop naming shared split chunks after the first entrypoint
- [#36009](https://github.com/oven-sh/bun/pull/36009) `+103/-2` cov=100% — bundler: error when asset naming yields the same output path for different content
- [#35668](https://github.com/oven-sh/bun/pull/35668) `+74/-4` cov=100% — bundler: never pick bare `$` as a minified identifier _(also: js-parser)_
- [#35628](https://github.com/oven-sh/bun/pull/35628) `+69/-17` cov=75% — cli: warn when --compile overrides --target=node/browser to --target=bun
- [#35263](https://github.com/oven-sh/bun/pull/35263) `+94/-251` cov=100% — test(bundler): compile-windows-metadata.test.ts 64s -> 25s on Windows _(also: windows)_
- [#34188](https://github.com/oven-sh/bun/pull/34188) `+258/-14` cov=100% — bundler: JS-escape file-loader asset paths at chunk assembly
- [#34187](https://github.com/oven-sh/bun/pull/34187) `+47/-0` cov=100% — Bun.write: reject writes to embedded /$bunfs/ paths in compiled binaries
- [#33861](https://github.com/oven-sh/bun/pull/33861) `+135/-25` cov=100% — sourcemap: keep UTF-8 BOM in Source.contents for correct line-1 columns and byte-exact sourcesContent _(also: js-parser, resolver)_
- [#30490](https://github.com/oven-sh/bun/pull/30490) `+39/-0` cov=100% — fix(bundler): don't let comments leak into minify renamer
- [#35680](https://github.com/oven-sh/bun/pull/35680) `+777/-45` cov=93% — bundler: bundle template-literal require()/import() via a __glob lookup map _(also: js-parser)_
- [#36133](https://github.com/oven-sh/bun/pull/36133) `+67/-1` cov=100% — js_printer: parenthesize inlined negative enum value on LHS of ** _(also: js-parser)_
- [#36083](https://github.com/oven-sh/bun/pull/36083) `+193/-273` cov=100% — test(bundler): fold redundant compiles in bun-build-compile-sourcemap.test.ts
- [#35962](https://github.com/oven-sh/bun/pull/35962) `+69/-2` cov=100% — js_parser: error on delete of bare identifier when bundling to ESM _(also: js-parser)_
- [#35720](https://github.com/oven-sh/bun/pull/35720) `+151/-361` cov=100% — test(bundler): compile once per execArgv set in compile-argv.test.ts
- [#35442](https://github.com/oven-sh/bun/pull/35442) `+27/-5` cov=100% — tsconfig: stop forcing the Solid JSX runtime for jsxImportSource: "solid-js" _(also: resolver)_
- [#35416](https://github.com/oven-sh/bun/pull/35416) `+114/-547` cov=100% — test(bundler): consolidate compile-autoload tests (23 compiles -> 11, 71s -> 35s on ASAN)
- [#34616](https://github.com/oven-sh/bun/pull/34616) `+27/-1` cov=100% — Bun.Transpiler: use the same AggregateError message for transform() and transformSync() _(also: js-parser)_
- [#34191](https://github.com/oven-sh/bun/pull/34191) `+123/-6` cov=80% — bundler: stop leaking build-machine paths through require.resolve in --compile _(also: js-parser, resolver)_
- [#34017](https://github.com/oven-sh/bun/pull/34017) `+16/-1` cov=100% — fix(transpiler): preserve UTF-8 in scan()/scanImports() import paths _(also: js-parser)_
- [#33859](https://github.com/oven-sh/bun/pull/33859) `+65/-1` cov=100% — bundler: gate @bun pragma and @bun-cjs wrapper on build target, not entry hashbang
- [#33384](https://github.com/oven-sh/bun/pull/33384) `+115/-11` cov=100% — Derive decorator options from tsconfig in scanImports and the REPL _(also: js-parser)_
- [#33381](https://github.com/oven-sh/bun/pull/33381) `+709/-14` cov=70% — Inline lowering helpers when the output can't import bun:wrap _(also: js-parser)_
- [#32577](https://github.com/oven-sh/bun/pull/32577) `+102/-12` cov=100% — Keep escaped newlines in string literals without --minify-syntax _(also: js-parser)_
- [#32173](https://github.com/oven-sh/bun/pull/32173) `+133/-9` cov=100% — Substitute top-level this with undefined in ES modules _(also: js-parser, jsc-bindings)_
- [#30788](https://github.com/oven-sh/bun/pull/30788) `+85/-8` cov=100% — bundler/ThreadPool: use Mutex::new() for static init
- [#30667](https://github.com/oven-sh/bun/pull/30667) `+31/-0` cov=100% — Fix Transpiler.transformSync crash on empty source with minify.identifiers _(also: js-parser, crash-handler)_
- [#35060](https://github.com/oven-sh/bun/pull/35060) `+473/-48` cov=82% — bundler: run concurrent Bun.build() calls on overflow threads _(also: resolver)_
- [#35676](https://github.com/oven-sh/bun/pull/35676) `+852/-58` cov=89% — bundler: bundle require("./dir/" + x) by scanning the directory (shelljs) _(also: js-parser)_
- [#35645](https://github.com/oven-sh/bun/pull/35645) `+562/-1` cov=88% — bundler: deduplicate external ES-module imports across files in a chunk
- [#35623](https://github.com/oven-sh/bun/pull/35623) `+117/-26` cov=100% — compile: rename temp file by the path inject() opened, not /proc/self/fd
- [#34000](https://github.com/oven-sh/bun/pull/34000) `+54/-2` cov=100% — fix(runtime): decode Bun.main as UTF-8 in compiled binaries
- [#35581](https://github.com/oven-sh/bun/pull/35581) `+215/-13` cov=86% — bundler: bind require in the CommonJS wrapper when the body contains direct eval
- [#31667](https://github.com/oven-sh/bun/pull/31667) `+334/-115` cov=86% — bundler: eliminate quadratic blow-ups on deep re-export chains
- [#35656](https://github.com/oven-sh/bun/pull/35656) `+272/-115` cov=85% — bundler: derive __toESM isNodeMode from resolver module type, not exports_kind _(also: resolver, js-parser)_
- [#32795](https://github.com/oven-sh/bun/pull/32795) `+209/-9` cov=67% — Fix panic when bundling CSS that contains invalid UTF-8 _(also: js-parser, crash-handler)_
- [#34982](https://github.com/oven-sh/bun/pull/34982) `+110/-3` cov=100% — cli: apply --extension-order to ESM imports; split --main-fields/--extension-order on commas
- [#34315](https://github.com/oven-sh/bun/pull/34315) `+50/-19` cov=100% — cli: name --target and echo the rejected value when it is invalid
- [#28853](https://github.com/oven-sh/bun/pull/28853) `+284/-2` cov=100% — bunfig: add [resolve] conditions to configure custom export conditions
- [#35643](https://github.com/oven-sh/bun/pull/35643) `+201/-1` cov=67% — bundler: preserve require.resolve() specifier instead of emitting absolute path
- [#36286](https://github.com/oven-sh/bun/pull/36286) `+63/-1` cov=100% — worker: resolve `new URL(..., import.meta.url)` specifiers in compiled binaries _(also: jsc-bindings)_
- [#34552](https://github.com/oven-sh/bun/pull/34552) `+74/-12` cov=60% — test/bundler: stop silently dropping every itBundled test on Windows _(also: windows)_
- [#33053](https://github.com/oven-sh/bun/pull/33053) `+124/-14` cov=80% — bundler: don't cache a module evaluation that threw as a success
- [#33052](https://github.com/oven-sh/bun/pull/33052) `+123/-25` cov=80% — bundler: keep a "__proto__" export name an own property in generated exports _(also: js-parser)_
- [#31697](https://github.com/oven-sh/bun/pull/31697) `+195/-21` cov=100% — bake: fix dev server crashes in SCB dependency tracing and route syntax error reporting
- [#33799](https://github.com/oven-sh/bun/pull/33799) `+161/-3` cov=100% — Bun.plugin: error when an onResolve'd namespace has no matching onLoad
- [#32059](https://github.com/oven-sh/bun/pull/32059) `+129/-0` cov=100% — Pick data: URL module loaders from the MIME type at runtime
- [#36261](https://github.com/oven-sh/bun/pull/36261) `+95/-10` cov=80% — cli: make --jsx-side-effects work when passed alone _(also: jsc-bindings)_
- [#36191](https://github.com/oven-sh/bun/pull/36191) `+87/-6` cov=80% — bundler(splitting): rewrite self dynamic imports to the chunk path
- [#35903](https://github.com/oven-sh/bun/pull/35903) `+93/-20` cov=100% — resolver: reject multi-star exports pattern keys and empty '*' captures _(also: resolver)_
- [#35470](https://github.com/oven-sh/bun/pull/35470) `+468/-145` cov=75% — bundler: resolve __dirname/__filename at runtime for --target=bun/node _(also: jsc-bindings, js-parser)_
- [#32061](https://github.com/oven-sh/bun/pull/32061) `+50/-0` cov=100% — Accept case-insensitive data: URL schemes in the module resolver _(also: resolver)_
- [#29312](https://github.com/oven-sh/bun/pull/29312) `+199/-4` cov=100% — Minify: pick the shorter of decimal vs scientific for floats _(also: js-parser)_
- [#36245](https://github.com/oven-sh/bun/pull/36245) `+45/-0` cov=100% — resolver: rewind cached directory fds before re-iterating them _(also: resolver)_
- [#35898](https://github.com/oven-sh/bun/pull/35898) `+91/-2` cov=100% — resolver: allow '#/'-prefixed subpath imports _(also: resolver)_
- [#35447](https://github.com/oven-sh/bun/pull/35447) `+95/-5` cov=100% — resolver: apply the module/main auto-fallback to jsnext:main _(also: resolver)_
- [#35212](https://github.com/oven-sh/bun/pull/35212) `+108/-34` cov=100% — resolver: check user externals before browser node builtin polyfills _(also: resolver)_
- [#34562](https://github.com/oven-sh/bun/pull/34562) `+161/-50` cov=100% — resolver: substitute tsconfig paths '*' textually instead of path-joining _(also: resolver)_
- [#31927](https://github.com/oven-sh/bun/pull/31927) `+50/-1` cov=100% — dev server: keep bare HTML script specifiers project-relative in combined rebuilds
- [#34542](https://github.com/oven-sh/bun/pull/34542) `+41/-0` cov=50% — test/bundler: destructure timeoutScale so tests that set it aren't silently dropped
- [#30655](https://github.com/oven-sh/bun/pull/30655) `+86/-6` cov=100% — minifier: drop parens around single-identifier arrow parameter _(also: js-parser)_
- [#36078](https://github.com/oven-sh/bun/pull/36078) `+157/-118` cov=22% — Bun.build: expose build.config as a snapshot to plugin setup() _(also: ci-build)_
- [#36269](https://github.com/oven-sh/bun/pull/36269) `+265/-51` cov=70% — bundler: stop --jsx-* flags from overriding tsconfig jsx dev/prod
- [#36246](https://github.com/oven-sh/bun/pull/36246) `+143/-46` cov=60% — bundler: reject --env patterns where '*' is not a trailing wildcard
- [#35577](https://github.com/oven-sh/bun/pull/35577) `+28/-9` cov=60% — docs(bundler): clarify that publicPath does not rewrite external module specifiers
- [#33062](https://github.com/oven-sh/bun/pull/33062) `+129/-0` cov=75% — Apply defines to computed string-literal member accesses _(also: js-parser)_
- [#35617](https://github.com/oven-sh/bun/pull/35617) `+192/-0` cov=67% — bundler: rename esm top-level vars that collide with host globals _(also: js-parser)_
- [#35579](https://github.com/oven-sh/bun/pull/35579) `+60/-15` cov=67% — bundler: stop emitting __require for external dynamic imports
- [#35635](https://github.com/oven-sh/bun/pull/35635) `+519/-1` cov=71% — bundler: merge duplicate external ESM imports across files in a chunk
- [#35639](https://github.com/oven-sh/bun/pull/35639) `+132/-4` cov=67% — bundler: point 'Could not resolve' errors at --external and try/catch _(also: js-parser)_
- [#34935](https://github.com/oven-sh/bun/pull/34935) `+111/-8` cov=67% — bundler: expose default on the namespace of a converted CommonJS import *
- [#32716](https://github.com/oven-sh/bun/pull/32716) `+76/-6` cov=67% — bundler: allow relative FileMap keys without tripping absolute-path debug asserts
- [#35554](https://github.com/oven-sh/bun/pull/35554) `+370/-11` cov=56% — bun build: apply bunfig [serve.static].plugins to CLI bundles _(also: jsc-bindings, ci-build)_
- [#35104](https://github.com/oven-sh/bun/pull/35104) `+323/-2` cov=50% — build --compile: reject cross-compile base binary whose header mismatches --target
- [#30352](https://github.com/oven-sh/bun/pull/30352) `+123/-19` cov=75% — Replace stable slice sorts with sort_unstable where stability is not observable
- [#34531](https://github.com/oven-sh/bun/pull/34531) `+139/-52` cov=67% — bundler: index input keys in metafile markdown to avoid O(N^2) scans
- [#32143](https://github.com/oven-sh/bun/pull/32143) `+75/-34` cov=86% — bake: fix "Runtime file not found" panic in production builds of custom frameworks _(also: js-parser, crash-handler)_
- [#36015](https://github.com/oven-sh/bun/pull/36015) `+356/-125` cov=60% — bundler(html): fix asset-URL classification and emit contract
- [#36011](https://github.com/oven-sh/bun/pull/36011) `+429/-7` cov=60% — bundler(html): emit <link rel="preload" as="style"> as a standalone CSS chunk
- [#34826](https://github.com/oven-sh/bun/pull/34826) `+262/-32` cov=80% — minify: lower if statements to conditionals and logical expressions _(also: js-parser)_
- [#35134](https://github.com/oven-sh/bun/pull/35134) `+323/-3` cov=67% — compile: detect truncated standalone executables before they SIGBUS
- [#34353](https://github.com/oven-sh/bun/pull/34353) `+62/-18` cov=67% — compile: bail out when inject() returns Fd::INVALID instead of printing a spurious /proc/self/fd error
- [#30850](https://github.com/oven-sh/bun/pull/30850) `+547/-23` cov=56% — child_process: support piping subprocess stdio streams between spawns _(also: spawn)_
- [#36142](https://github.com/oven-sh/bun/pull/36142) `+127/-16` cov=80% — transpiler: key decorator flavor on experimentalDecorators only _(also: resolver, js-parser)_
- [#35595](https://github.com/oven-sh/bun/pull/35595) `+114/-16` cov=75% — resolver: read every default main-field name when parsing package.json _(also: resolver, install)_
- [#34734](https://github.com/oven-sh/bun/pull/34734) `+70/-8` cov=75% — printer: keep this undefined when calling an imported binding rewritten to a property access _(also: js-parser)_
- [#35611](https://github.com/oven-sh/bun/pull/35611) `+231/-5` cov=50% — bundler: detect module.exports=require() redirect through a constant-test if/else _(also: js-parser)_
- [#35544](https://github.com/oven-sh/bun/pull/35544) `+133/-3` cov=75% — parser: reject parameter decorators without experimentalDecorators _(also: js-parser, resolver)_
- [#33883](https://github.com/oven-sh/bun/pull/33883) `+154/-14` cov=75% — resolver: record enclosing package.json regardless of "name" field _(also: resolver, install)_
- [#32162](https://github.com/oven-sh/bun/pull/32162) `+382/-22` cov=33% — Fix invalid macOS code signature in bun build --compile output
- [#36401](https://github.com/oven-sh/bun/pull/36401) `+135/-2` cov=50% — Bun.build: bind default import to exports.default for loader: "object" plugins _(also: ci-build)_
- [#35308](https://github.com/oven-sh/bun/pull/35308) `+79/-0` cov=50% — bundler: warn when a bare import is dropped by sideEffects
- [#34986](https://github.com/oven-sh/bun/pull/34986) `+180/-8` cov=50% — dotenv: load .env.{NODE_ENV} literally instead of falling back to development _(also: resolver)_
- [#36008](https://github.com/oven-sh/bun/pull/36008) `+89/-6` cov=50% — bundler(html): preserve ?query/#fragment when rewriting asset URLs
- [#34534](https://github.com/oven-sh/bun/pull/34534) `+108/-4` cov=50% — bundler: make metafile import paths deterministic and match input keys
- [#33857](https://github.com/oven-sh/bun/pull/33857) `+87/-11` cov=50% — bundler: let explicit `define` win over `env`-derived process.env.X
- [#36013](https://github.com/oven-sh/bun/pull/36013) `+282/-44` cov=40% — bundler(html): rewrite prefetch/modulepreload/preload link hrefs _(also: js-parser)_
- [#36296](https://github.com/oven-sh/bun/pull/36296) `+25/-6` cov=67% — HTMLRewriter: clamp unknown file-blob size so it does not overflow the preallocated-buffer hint
- [#32914](https://github.com/oven-sh/bun/pull/32914) `+224/-24` cov=67% — Quote the ETag header values in the HTML import manifest per RFC 9110
- [#36209](https://github.com/oven-sh/bun/pull/36209) `+75/-2` cov=50% — cli: stop --jsx-* flags from switching the automatic JSX runtime to production
- [#36293](https://github.com/oven-sh/bun/pull/36293) `+469/-37` cov=54% — watcher: add BUN_WATCHER_USE_POLLING stat-polling fallback for --watch/--hot _(also: jsc-bindings)_
- [#35952](https://github.com/oven-sh/bun/pull/35952) `+43/-15` cov=33% — Bun.build: honor `env: "disable"` for process.env.NODE_ENV _(also: ci-build)_
- [#35053](https://github.com/oven-sh/bun/pull/35053) `+141/-29` cov=33% — bundler: use onResolve-returned path for external imports
- [#34341](https://github.com/oven-sh/bun/pull/34341) `+100/-10` cov=50% — exe_format/macho: reject inputs shorter than the Mach-O header instead of panicking

### test-runner — bun test, jest, expect
_strong familiarity · 18 PRs total, 15 above threshold_

- [#34179](https://github.com/oven-sh/bun/pull/34179) `+202/-50` cov=60% — test runner: cap assertion diff output to stop unbounded allocation
- [#34995](https://github.com/oven-sh/bun/pull/34995) `+34/-2` cov=100% — bun test: create parent directories for JUnit --reporter-outfile
- [#30284](https://github.com/oven-sh/bun/pull/30284) `+417/-35` cov=88% — Skip `dist/` and `build/` by default during `bun test` discovery
- [#35503](https://github.com/oven-sh/bun/pull/35503) `+88/-28` cov=71% — bun test: union repeated --test-name-pattern/-t flags instead of last-wins
- [#35139](https://github.com/oven-sh/bun/pull/35139) `+298/-41` cov=67% — bun test: print summary and fail when process.exit() is called mid-run
- [#36218](https://github.com/oven-sh/bun/pull/36218) `+306/-31` cov=67% — bun test: record load errors and unhandled errors in the JUnit report
- [#35891](https://github.com/oven-sh/bun/pull/35891) `+380/-2` cov=67% — bun test: surface unhandled errors that fire after the final test settles
- [#32928](https://github.com/oven-sh/bun/pull/32928) `+156/-39` cov=67% — test runner: don't throw synchronously on an invalid expect.assertions(n) count
- [#34042](https://github.com/oven-sh/bun/pull/34042) `+408/-26` cov=60% — bun test: detect obsolete snapshots and fix -u "added" mislabel
- [#36398](https://github.com/oven-sh/bun/pull/36398) `+146/-10` cov=50% — bun test: reset fake timers and setSystemTime between test files
- [#35666](https://github.com/oven-sh/bun/pull/35666) `+149/-4` cov=50% — bun test: match positional filters containing glob syntax as globs
- [#32905](https://github.com/oven-sh/bun/pull/32905) `+110/-9` cov=50% — bun:test: deprecate legacy Jest matcher aliases in types and docs
- [#32817](https://github.com/oven-sh/bun/pull/32817) `+273/-52` cov=50% — bun test: fix inline snapshot conflict, beforeAll skip, and test.each title reporting
- [#35516](https://github.com/oven-sh/bun/pull/35516) `+125/-51` cov=33% — bun test: carry node:test skip/todo reasons into the JUnit `<skipped>` element
- [#34325](https://github.com/oven-sh/bun/pull/34325) `+133/-7` cov=33% — fake timers: cap jest.runAllTimers() at timerLimit (default 100000)

### resolver — module resolver
_strong familiarity · 39 PRs total, 37 above threshold_

- [#36251](https://github.com/oven-sh/bun/pull/36251) `+227/-22` cov=100% — resolver, watcher: stop leaking file descriptors on every --hot reload _(also: jsc-bindings)_
- [#34411](https://github.com/oven-sh/bun/pull/34411) `+113/-120` cov=100% — resolver: take Entry.mutex when filling Entry.abs_path in load_as_file and siblings _(also: jsc-bindings)_
- [#34284](https://github.com/oven-sh/bun/pull/34284) `+137/-19` cov=100% — resolver: dedupe DirnameStore interns across bust+reread and Route::parse
- [#32392](https://github.com/oven-sh/bun/pull/32392) `+283/-153` cov=100% — resolver: resolve the entry point by stat instead of reading its directory _(also: jsc-bindings)_
- [#36275](https://github.com/oven-sh/bun/pull/36275) `+386/-1` cov=100% — resolver: reject ?query on a bare package root that resolves via node_modules _(also: jsc-bindings)_
- [#36140](https://github.com/oven-sh/bun/pull/36140) `+452/-177` cov=100% — net/resolver: report EMFILE as EMFILE instead of ECONNREFUSED/MODULE_NOT_FOUND/code-less listen error _(also: jsc-bindings)_
- [#31958](https://github.com/oven-sh/bun/pull/31958) `+252/-14` cov=87% — Make the bundler honor --preserve-symlinks and add preserveSymlinks to Bun.build _(also: bundler)_
- [#32165](https://github.com/oven-sh/bun/pull/32165) `+65/-1` cov=100% — dns: fail resolver queries with ECONNREFUSED when the server refuses, instead of ETIMEOUT
- [#33890](https://github.com/oven-sh/bun/pull/33890) `+289/-21` cov=100% — resolver: throw ERR_INVALID_PACKAGE_CONFIG for malformed package.json _(also: install)_
- [#36299](https://github.com/oven-sh/bun/pull/36299) `+506/-40` cov=100% — resolver: auto-resolve extensions for wildcard exports/imports targets _(also: bundler)_
- [#35549](https://github.com/oven-sh/bun/pull/35549) `+350/-64` cov=100% — resolver: fall through the "bun" exports condition when its target file is missing
- [#35197](https://github.com/oven-sh/bun/pull/35197) `+143/-168` cov=100% — resolver: stop honoring removed trailing-slash exports subpath folder mappings _(also: bundler)_
- [#35196](https://github.com/oven-sh/bun/pull/35196) `+144/-0` cov=100% — resolver: continue past invalid/null entries in exports/imports array targets
- [#34530](https://github.com/oven-sh/bun/pull/34530) `+133/-1` cov=100% — resolver: hash-index exact-key lookup in large exports maps
- [#34496](https://github.com/oven-sh/bun/pull/34496) `+458/-38` cov=100% — resolver: resolve tsconfig extends package specifiers and TS5 array form _(also: bundler)_
- [#32312](https://github.com/oven-sh/bun/pull/32312) `+143/-11` cov=100% — resolver: store exports expansion_keys as indices instead of cloned subtrees
- [#36425](https://github.com/oven-sh/bun/pull/36425) `+118/-0` cov=100% — resolver: reject backslash in bare package specifiers on POSIX
- [#36054](https://github.com/oven-sh/bun/pull/36054) `+272/-47` cov=100% — resolver: reject case-mismatched extension probes that do not exist on disk
- [#35902](https://github.com/oven-sh/bun/pull/35902) `+131/-61` cov=100% — resolver: gate pkg/package.json behind the exports map (Node parity) _(also: install)_
- [#35857](https://github.com/oven-sh/bun/pull/35857) `+87/-7` cov=100% — resolver: bound load_as_file path before writing into its PathBuffer
- [#35221](https://github.com/oven-sh/bun/pull/35221) `+78/-3` cov=100% — net.connect: report resolver failures with a negative errno instead of hanging
- [#34980](https://github.com/oven-sh/bun/pull/34980) `+45/-59` cov=100% — resolver: suppress spurious "directory mismatch" warning from --tsconfig-override
- [#34539](https://github.com/oven-sh/bun/pull/34539) `+181/-34` cov=100% — resolver: hash-lookup tsconfig paths exact match, cache '*' position at parse
- [#36047](https://github.com/oven-sh/bun/pull/36047) `+314/-31` cov=75% — resolver: key dir-entry cache by exact basename on case-sensitive filesystems _(also: bundler, jsc-bindings)_
- [#35455](https://github.com/oven-sh/bun/pull/35455) `+80/-84` cov=100% — bun:test: close scanned directory fds before tests run
- [#34276](https://github.com/oven-sh/bun/pull/34276) `+95/-24` cov=100% — router: dedupe DirnameStore interns so FileSystemRouter.reload() does not exhaust the store
- [#29919](https://github.com/oven-sh/bun/pull/29919) `+139/-18` cov=100% — fs: reuse DirEntry in bustEntriesCache instead of orphaning it _(also: jsc-bindings)_
- [#30322](https://github.com/oven-sh/bun/pull/30322) `+402/-64` cov=71% — resolver: fix sideEffects glob matching on Windows _(also: bundler, jsc-bindings)_
- [#36202](https://github.com/oven-sh/bun/pull/36202) `+78/-13` cov=100% — glob: fall back to lstat when the literal-tail stat fails on a broken symlink
- [#34989](https://github.com/oven-sh/bun/pull/34989) `+37/-11` cov=100% — glob: return absolute literal patterns from scan()/scanSync()
- [#29941](https://github.com/oven-sh/bun/pull/29941) `+87/-16` cov=100% — bun run --filter: use original-case basename for workspace dirs _(also: install)_
- [#34235](https://github.com/oven-sh/bun/pull/34235) `+866/-104` cov=100% — Support solution-style tsconfig.json project references
- [#33208](https://github.com/oven-sh/bun/pull/33208) `+190/-13` cov=80% — Fail `bun run` on a malformed bunfig.toml; detect tsconfig `extends` cycles _(also: toml)_
- [#35608](https://github.com/oven-sh/bun/pull/35608) `+275/-43` cov=60% — Load workspace root .env from package subdirectories _(also: bundler, install)_
- [#35467](https://github.com/oven-sh/bun/pull/35467) `+467/-1` cov=80% — bundler: tolerate unresolved optional peerDependencies (NestJS --compile) _(also: bundler)_
- [#36044](https://github.com/oven-sh/bun/pull/36044) `+388/-155` cov=62% — Bun.Glob: walk the filesystem lazily in scan()/scanSync()
- [#33084](https://github.com/oven-sh/bun/pull/33084) `+196/-12` cov=75% — Re-resolve through updated package.json files under --hot _(also: jsc-bindings, install)_

### crypto — node:crypto, Bun.password
_strong familiarity · 13 PRs total, 6 above threshold_

- [#35991](https://github.com/oven-sh/bun/pull/35991) `+87/-4` cov=100% — node:crypto: deliver ERR_CRYPTO_HASH_FINALIZED via stream error path in Hash/Hmac
- [#34964](https://github.com/oven-sh/bun/pull/34964) `+232/-103` cov=100% — crypto,util: coerce later arguments before capturing input buffers in Bun.* hash/UUID/indexOfLine/verifySync
- [#34926](https://github.com/oven-sh/bun/pull/34926) `+261/-64` cov=100% — node:crypto: accept options object in crypto.hash() for outputEncoding/outputLength
- [#33865](https://github.com/oven-sh/bun/pull/33865) `+65/-18` cov=67% — Bun.password: reject argon2 cost options that verify would refuse
- [#33702](https://github.com/oven-sh/bun/pull/33702) `+70/-34` cov=100% — Bun.password: validate async hash/verify args like the sync forms
- [#32320](https://github.com/oven-sh/bun/pull/32320) `+33/-16` cov=50% — crypto: encode base64url digests directly into the WTF string buffer

### jsc-bindings — JSC bindings catch-all (broad; top matches only)
_strong familiarity · 831 PRs total, 52 above threshold (showing top 40)_

- [#34406](https://github.com/oven-sh/bun/pull/34406) `+77/-12` cov=100% — JSC::Heap: count Fast/Oversize typed array vectors in arrayBufferSize() _(also: ci-build, webkit-upgrade)_
- [#35778](https://github.com/oven-sh/bun/pull/35778) `+112/-1` cov=75% — jsc: fix CodeCache collision running wrong module code / segfaulting _(also: ci-build, webkit-upgrade)_
- [#34889](https://github.com/oven-sh/bun/pull/34889) `+210/-16` cov=100% — inspect, pretty_format, ipc, yaml: harden recursive walkers against stack overflow and dangling state _(also: yaml)_
- [#33894](https://github.com/oven-sh/bun/pull/33894) `+77/-57` cov=100% — require(esm): make __esModule an own enumerable property on a null-prototype namespace _(also: ci-build, webkit-upgrade)_
- [#35993](https://github.com/oven-sh/bun/pull/35993) `+786/-28` cov=100% — fs: back createWriteStream(path) with a FileSink that adopts the fd _(also: sys)_
- [#35747](https://github.com/oven-sh/bun/pull/35747) `+169/-52` cov=100% — runtime transpiler cache: per-uid root, ownership check, mandatory payload hashes _(also: sys, js-parser)_
- [#35477](https://github.com/oven-sh/bun/pull/35477) `+275/-3` cov=100% — stdin: set O_NONBLOCK on the stdio fd when process.stdin starts reading _(also: sys)_
- [#35064](https://github.com/oven-sh/bun/pull/35064) `+289/-22` cov=100% — stdio: surface EPIPE from console.log/process.stdout.write as 'error' on process.stdout _(also: sys)_
- [#30635](https://github.com/oven-sh/bun/pull/30635) `+354/-15` cov=100% — console: surface EPIPE from console.log on process.stdout _(also: sys)_
- [#35882](https://github.com/oven-sh/bun/pull/35882) `+1058/-105` cov=89% — process.env: Node-semantics exotic object on POSIX; coerce/validate/setenv-sync, first-wins dup load, typed-cache invalidate
- [#34775](https://github.com/oven-sh/bun/pull/34775) `+273/-11` cov=86% — crash_handler: register a sigaltstack on every thread and keep SA_ONSTACK after JSC init _(also: crash-handler)_
- [#34106](https://github.com/oven-sh/bun/pull/34106) `+2128/-21` cov=86% — feat(inspector): runtime activation via SIGUSR1 / process._debugProcess _(also: ci-build, webkit-upgrade)_
- [#35289](https://github.com/oven-sh/bun/pull/35289) `+37/-3` cov=100% — Bun.inspect: treat {depth: null} as unlimited depth
- [#34033](https://github.com/oven-sh/bun/pull/34033) `+168/-22` cov=100% — console: honor customInspect option in Bun.inspect and console.dir
- [#31809](https://github.com/oven-sh/bun/pull/31809) `+316/-8` cov=100% — console.dir: honor maxArrayLength in the native formatter
- [#31699](https://github.com/oven-sh/bun/pull/31699) `+543/-185` cov=81% — ci: add linux aarch64 ASAN build and test lanes to PR pipelines _(also: ci-build)_
- [#35588](https://github.com/oven-sh/bun/pull/35588) `+107/-15` cov=100% — Clear JSC CodeCache on --hot reload and balance ref_strings refcount
- [#35440](https://github.com/oven-sh/bun/pull/35440) `+155/-9` cov=100% — crash_handler: tag JSC JIT-pool frames instead of discarding them _(also: crash-handler)_
- [#34618](https://github.com/oven-sh/bun/pull/34618) `+141/-5` cov=80% — process: write process.title through to the OS on Linux and coerce non-string assignments
- [#35376](https://github.com/oven-sh/bun/pull/35376) `+55/-69` cov=100% — jsc: move close_all_socket_groups to VirtualMachine; hot_reloader scopeguard via BackRef
- [#33314](https://github.com/oven-sh/bun/pull/33314) `+152/-59` cov=100% — jsc: make VirtualMachine::event_loop_handle atomic for the cross-thread wakeup path
- [#31787](https://github.com/oven-sh/bun/pull/31787) `+335/-5` cov=75% — Don't crash at startup when a standalone executable's embedded graph is corrupted _(also: bundler, sys)_
- [#35456](https://github.com/oven-sh/bun/pull/35456) `+450/-8` cov=89% — worker: inherit bunfig/CLI preloads so runtime plugins work in workers
- [#33316](https://github.com/oven-sh/bun/pull/33316) `+753/-76` cov=71% — Bytecode cache for the JS builtins in `bun build --compile --bytecode` _(also: bundler, ci-build)_
- [#34864](https://github.com/oven-sh/bun/pull/34864) `+246/-50` cov=88% — Bun.spawnSync: write stdout/stderr into a caller-provided Uint8Array _(also: spawn)_
- [#32271](https://github.com/oven-sh/bun/pull/32271) `+74/-9` cov=100% — bindings: fix toUInt64NoTruncate dropping doubles >= 2^51 to zero
- [#30243](https://github.com/oven-sh/bun/pull/30243) `+50/-7` cov=100% — Unwrap JSC::Exception in promise rejection bindings
- [#33786](https://github.com/oven-sh/bun/pull/33786) `+158/-24` cov=83% — node:net: pass listen() backlog to the kernel instead of hardcoding 512
- [#36048](https://github.com/oven-sh/bun/pull/36048) `+264/-99` cov=67% — resolver: fall back to the literal path when a specifier's ?-stripped prefix does not resolve _(also: bundler, sys)_
- [#31721](https://github.com/oven-sh/bun/pull/31721) `+595/-32` cov=64% — Preserve AsyncLocalStorage context in unhandledRejection handlers _(also: ci-build, webkit-upgrade)_
- [#35227](https://github.com/oven-sh/bun/pull/35227) `+46/-45` cov=100% — jsc: reject callables in validate_object to match Node's validateObject
- [#34836](https://github.com/oven-sh/bun/pull/34836) `+59/-8` cov=100% — jsc: pick a/an in throw_invalid_argument_type error messages
- [#33777](https://github.com/oven-sh/bun/pull/33777) `+227/-18` cov=100% — process: guard JSC's GC suspend signal against unsolicited SIGPWR on Linux
- [#32279](https://github.com/oven-sh/bun/pull/32279) `+25/-8` cov=100% — jsc: use saturating coerce::<i32> for Map/Set size display _(also: crypto)_
- [#36214](https://github.com/oven-sh/bun/pull/36214) `+104/-6` cov=100% — event_loop: reserve TaskTag(0) as a sentinel for zeroed ConcurrentTask
- [#33658](https://github.com/oven-sh/bun/pull/33658) `+93/-27` cov=100% — webcore: propagate JSON.parse diagnostic from Body/Blob .json()
- [#33023](https://github.com/oven-sh/bun/pull/33023) `+221/-50` cov=100% — Blob: stringify null/undefined parts, accept iterable blobParts, coerce slice() arguments
- [#32012](https://github.com/oven-sh/bun/pull/32012) `+77/-8` cov=100% — Skip the delete-on-reboot MoveFileExW call in dlopen when the process is not elevated _(also: napi)_
- [#29587](https://github.com/oven-sh/bun/pull/29587) `+390/-67` cov=100% — Dedupe extracted embedded native modules in compiled binaries _(also: napi)_
- [#35186](https://github.com/oven-sh/bun/pull/35186) `+335/-35` cov=71% — tls: make handshake success match socket.authorized; extend X509 error-code table

### node-fs — node:fs
_working knowledge · 63 PRs total, 53 above threshold (showing top 30)_

- [#33034](https://github.com/oven-sh/bun/pull/33034) `+285/-26` cov=100% — node:fs: fix operations on Windows filenames with trailing dots or spaces _(also: windows)_
- [#35928](https://github.com/oven-sh/bun/pull/35928) `+300/-90` cov=89% — node:fs: pin the directory fd at opendir time _(also: sys)_
- [#35159](https://github.com/oven-sh/bun/pull/35159) `+42/-0` cov=100% — node:fs: mark the per-VM Binding box as LSan-ignored (fixes worker-terminate-lifetime.test.ts on main)
- [#36372](https://github.com/oven-sh/bun/pull/36372) `+135/-128` cov=100% — node:fs: extract /$bunfs/ readdir, drop per-call-site unsafe
- [#36324](https://github.com/oven-sh/bun/pull/36324) `+458/-135` cov=100% — node:fs: deliver ENAMETOOLONG via the callback with per-op syscall/path _(also: sys)_
- [#36259](https://github.com/oven-sh/bun/pull/36259) `+56/-2` cov=100% — fs.readFile: honor AbortSignal between read chunks
- [#35927](https://github.com/oven-sh/bun/pull/35927) `+277/-161` cov=100% — node:fs: recursive rm names the failing entry in err.path/err.syscall _(also: sys)_
- [#35800](https://github.com/oven-sh/bun/pull/35800) `+127/-6` cov=100% — node:fs: recursive rm continues past a child that raced to ENOENT
- [#35749](https://github.com/oven-sh/bun/pull/35749) `+178/-211` cov=100% — node:fs: recursive rm passes through unmapped errnos instead of reporting EFAULT
- [#35214](https://github.com/oven-sh/bun/pull/35214) `+164/-82` cov=100% — fs.copyFile, fs.cp: preserve source file ownership
- [#34758](https://github.com/oven-sh/bun/pull/34758) `+201/-11` cov=100% — node:fs: snapshot resizable ArrayBuffer inputs for async write/writev
- [#34395](https://github.com/oven-sh/bun/pull/34395) `+80/-1` cov=100% — node:fs: fs.readv with an empty buffers array throws EINVAL
- [#33436](https://github.com/oven-sh/bun/pull/33436) `+48/-57` cov=100% — node:fs: report ENOTDIR from fs.rm instead of EFAULT
- [#33432](https://github.com/oven-sh/bun/pull/33432) `+157/-79` cov=100% — node:fs: skip symlink cycles in recursive readdir instead of failing with ELOOP
- [#33421](https://github.com/oven-sh/bun/pull/33421) `+48/-0` cov=100% — node:fs: reject the empty path in native realpath instead of resolving it to the cwd
- [#33410](https://github.com/oven-sh/bun/pull/33410) `+98/-10` cov=100% — Preserve literal backslashes in fs.realpath on POSIX _(also: resolver)_
- [#32920](https://github.com/oven-sh/bun/pull/32920) `+33/-2` cov=100% — node:fs: ignore trailing slashes in realpath and realpathSync
- [#32301](https://github.com/oven-sh/bun/pull/32301) `+53/-3` cov=100% — node:fs: validate buffer type before offset in fs.read/readSync
- [#35931](https://github.com/oven-sh/bun/pull/35931) `+53/-8` cov=100% — node:fs: Dir.close must not close an fd it did not open
- [#34198](https://github.com/oven-sh/bun/pull/34198) `+22/-4` cov=100% — fs: reject null options in fs.glob/fs.globSync
- [#35275](https://github.com/oven-sh/bun/pull/35275) `+156/-11` cov=80% — node:fs: accept AbortSignal-shaped objects in readFile/writeFile/watch
- [#36135](https://github.com/oven-sh/bun/pull/36135) `+264/-40` cov=100% — fs: short write in createWriteStream overwrites head of file (NaN position coerced to 0)
- [#35757](https://github.com/oven-sh/bun/pull/35757) `+399/-51` cov=100% — Pin StringOrBuffer inputs so a later argument cannot free them mid-call _(also: bundler)_
- [#35705](https://github.com/oven-sh/bun/pull/35705) `+102/-25` cov=100% — shell(cp): parse every short flag in a -Rv/-vR cluster _(also: shell)_
- [#34988](https://github.com/oven-sh/bun/pull/34988) `+57/-18` cov=100% — node:fs: validate watchFile options.interval as uint32
- [#34913](https://github.com/oven-sh/bun/pull/34913) `+198/-28` cov=100% — shell(cp): honor -n instead of silently overwriting _(also: shell)_
- [#34909](https://github.com/oven-sh/bun/pull/34909) `+76/-18` cov=100% — fs: validate open() flags like Node (reject objects, don't clamp negatives)
- [#34908](https://github.com/oven-sh/bun/pull/34908) `+30/-3` cov=100% — fs: reject empty mkdtemp prefix with EINVAL
- [#34477](https://github.com/oven-sh/bun/pull/34477) `+42/-13` cov=100% — spawnSync: give the child a real pipe for stdin:"pipe" instead of the null device
- [#33559](https://github.com/oven-sh/bun/pull/33559) `+94/-24` cov=100% — fs: honor the flag option in appendFile / appendFileSync

### shell — Bun Shell
_working knowledge · 54 PRs total, 25 above threshold_

- [#35551](https://github.com/oven-sh/bun/pull/35551) `+462/-27` cov=100% — shell: buffer a fetch() Response body before redirecting it to stdin
- [#36196](https://github.com/oven-sh/bun/pull/36196) `+158/-5` cov=100% — shell: reject unsupported reserved words (while/for/until/case/!/{/...}) at parse time
- [#32377](https://github.com/oven-sh/bun/pull/32377) `+6/-1` cov=100% — Detect Build Tools-only Visual Studio installs in vs-shell.ps1
- [#35597](https://github.com/oven-sh/bun/pull/35597) `+283/-0` cov=100% — shell: set FORCE_COLOR for subprocesses whose output is relayed to a color terminal
- [#35318](https://github.com/oven-sh/bun/pull/35318) `+330/-175` cov=100% — shell: fix inverted file-blob check for builtin `> ${Response(...)}` redirect
- [#35314](https://github.com/oven-sh/bun/pull/35314) `+140/-8` cov=100% — shell: throw on Response/Request stream body used as redirect instead of delivering zero bytes
- [#33996](https://github.com/oven-sh/bun/pull/33996) `+96/-12` cov=100% — shell: throw instead of panic on ReadableStream redirect _(also: crash-handler)_
- [#34698](https://github.com/oven-sh/bun/pull/34698) `+227/-25` cov=100% — shell: fail the command when a `> ${buf}` redirect overflows the target Buffer
- [#35323](https://github.com/oven-sh/bun/pull/35323) `+57/-3` cov=100% — shell: helpful error when Response/Blob/ArrayBuffer is interpolated outside a redirect
- [#34906](https://github.com/oven-sh/bun/pull/34906) `+181/-120` cov=100% — shell(rm): refuse '.' and '..' operands instead of emptying the directory
- [#34904](https://github.com/oven-sh/bun/pull/34904) `+76/-10` cov=100% — shell: don't consume the next word as a file target for `2>&1` / `1>&2`
- [#34902](https://github.com/oven-sh/bun/pull/34902) `+33/-0` cov=100% — shell: error on unterminated single/double quote
- [#34901](https://github.com/oven-sh/bun/pull/34901) `+109/-6` cov=100% — shell: keep words after a redirection as arguments of the same command
- [#33997](https://github.com/oven-sh/bun/pull/33997) `+313/-26` cov=100% — shell: only treat digits as redirect fd numbers at word boundaries
- [#33551](https://github.com/oven-sh/bun/pull/33551) `+87/-1` cov=100% — shell: keep a backslash-escaped leading tilde literal
- [#33547](https://github.com/oven-sh/bun/pull/33547) `+28/-0` cov=100% — shell: concatenate backtick command substitution with surrounding word
- [#33420](https://github.com/oven-sh/bun/pull/33420) `+136/-2` cov=100% — shell: emit a word delimiter after a trailing `**`
- [#32327](https://github.com/oven-sh/bun/pull/32327) `+87/-3` cov=100% — shell(rm): don't abort sibling arguments when a parent rmdir fails
- [#29670](https://github.com/oven-sh/bun/pull/29670) `+124/-1` cov=100% — shell: normalize CRLF line endings in .sh files
- [#36409](https://github.com/oven-sh/bun/pull/36409) `+38/-0` cov=100% — shell: initialize env/cwd/throws defaults on new $.Shell() instances
- [#35616](https://github.com/oven-sh/bun/pull/35616) `+128/-12` cov=100% — shell(cp): accept `-r`/`--recursive`/`--verbose` and fix clustered short flags
- [#34900](https://github.com/oven-sh/bun/pull/34900) `+117/-3` cov=100% — shell(mv): honor -n/-i instead of silently overwriting
- [#34735](https://github.com/oven-sh/bun/pull/34735) `+92/-5` cov=100% — shell: reject NUL bytes in .cwd() and .env() options
- [#32280](https://github.com/oven-sh/bun/pull/32280) `+19/-5` cov=100% — shell: empty-string argv[0] should fail with "command not found"
- [#35888](https://github.com/oven-sh/bun/pull/35888) `+86/-47` cov=67% — shell: make $.escape() validate NUL/lone surrogates and always return a string

### spawn — spawn, Subprocess, child_process
_working knowledge · 50 PRs total, 26 above threshold_

- [#33240](https://github.com/oven-sh/bun/pull/33240) `+364/-52` cov=100% — spawn: give existing Bun.Terminal children the PTY as controlling terminal
- [#32321](https://github.com/oven-sh/bun/pull/32321) `+127/-99` cov=100% — spawn: surface real-time signals in Status::signal_code() _(also: install)_
- [#31114](https://github.com/oven-sh/bun/pull/31114) `+724/-101` cov=88% — Add `Subprocess.killTree(signal)` and `deathSignal` spawn option
- [#35924](https://github.com/oven-sh/bun/pull/35924) `+207/-76` cov=100% — spawn: per-process waiter-thread fallback when pidfd_open fails after posix_spawn
- [#35352](https://github.com/oven-sh/bun/pull/35352) `+48/-2` cov=100% — Bun.spawn: truncate stdout/stderr when redirected to Bun.file(path)
- [#33720](https://github.com/oven-sh/bun/pull/33720) `+91/-22` cov=100% — spawn: preserve full 32-bit exit codes on Windows _(also: windows)_
- [#30776](https://github.com/oven-sh/bun/pull/30776) `+279/-11` cov=100% — spawn: don't reinstall fault-signal handlers after sync-spawn signal forwarding _(also: bundler, crash-handler)_
- [#33624](https://github.com/oven-sh/bun/pull/33624) `+138/-6` cov=100% — child_process: place 'ipc' at the requested stdio index 0/1/2
- [#31717](https://github.com/oven-sh/bun/pull/31717) `+186/-4` cov=100% — spawn: retry via /bin/sh when exec returns ENOEXEC
- [#33521](https://github.com/oven-sh/bun/pull/33521) `+296/-4` cov=100% — spawn: honor the Blob window when a sliced Bun.file is used as stdin
- [#35851](https://github.com/oven-sh/bun/pull/35851) `+78/-13` cov=100% — spawn: drain pre-created terminal on child exit before resolving proc.exited
- [#34290](https://github.com/oven-sh/bun/pull/34290) `+131/-3` cov=100% — Bun.spawn: set TERM from terminal.name in the child env
- [#29002](https://github.com/oven-sh/bun/pull/29002) `+168/-44` cov=64% — fix(child_process): kill() returns false once the child has exited _(also: jsc-bindings)_
- [#35353](https://github.com/oven-sh/bun/pull/35353) `+173/-7` cov=100% — spawn: pipe Response/Request JS-stream body to child stdin instead of hanging
- [#35286](https://github.com/oven-sh/bun/pull/35286) `+96/-4` cov=100% — spawn: give child a pipe for empty-buffer stdin, not the null device
- [#33982](https://github.com/oven-sh/bun/pull/33982) `+107/-1` cov=100% — install: skip --no-orphans subreaper path for internal git spawns _(also: install)_
- [#36234](https://github.com/oven-sh/bun/pull/36234) `+34/-1` cov=100% — Bun.spawn: reject non-array `cmd` in the options-object form
- [#32977](https://github.com/oven-sh/bun/pull/32977) `+80/-50` cov=100% — child_process: stop giving the child a memfd on stdin
- [#32445](https://github.com/oven-sh/bun/pull/32445) `+100/-2` cov=100% — spawn: report cwd in error path when it does not exist
- [#36236](https://github.com/oven-sh/bun/pull/36236) `+164/-61` cov=100% — spawn: surface stdin ReadableStream producer errors via onExit / unhandledRejection
- [#35218](https://github.com/oven-sh/bun/pull/35218) `+83/-36` cov=100% — watcher: retry FileWatcher thread spawn on EAGAIN
- [#34697](https://github.com/oven-sh/bun/pull/34697) `+269/-50` cov=100% — io: harden POSIX pipe writer error paths against owner-dropping callbacks
- [#31299](https://github.com/oven-sh/bun/pull/31299) `+79/-30` cov=100% — Spawn the editor from Bun.openInEditor without spawnSync's signal forwarding
- [#34677](https://github.com/oven-sh/bun/pull/34677) `+231/-16` cov=80% — Bun.spawn: copy ArrayBuffer stdin to native memory instead of a Strong-rooted Uint8Array
- [#33892](https://github.com/oven-sh/bun/pull/33892) `+130/-33` cov=80% — child_process: surface EPIPE from spawnSync input writer as result.error
- [#30550](https://github.com/oven-sh/bun/pull/30550) `+810/-153` cov=100% — shell: support ReadableStream as stdin redirect in Bun.$ _(also: shell)_

### sys — sys crate
_working knowledge · 12 PRs total, 11 above threshold_

- [#36193](https://github.com/oven-sh/bun/pull/36193) `+1/-1` cov=100% — sys(windows): keep FILE_SYNCHRONOUS_IO_NONALERT when opening with O::NOFOLLOW _(also: windows)_
- [#35271](https://github.com/oven-sh/bun/pull/35271) `+153/-6` cov=100% — sys(windows): isatty on a HANDLE-backed fd must check GetConsoleMode _(also: windows)_
- [#36066](https://github.com/oven-sh/bun/pull/36066) `+198/-25` cov=100% — console/worker_threads: keep fd 1/2 blocking across worker start; poll on EAGAIN in the console writer
- [#34770](https://github.com/oven-sh/bun/pull/34770) `+419/-102` cov=100% — windows: recognize reserved DOS device names before NtCreateFile _(also: windows)_
- [#33560](https://github.com/oven-sh/bun/pull/33560) `+70/-1` cov=100% — console: do not drop output on EAGAIN when stdout is nonblocking
- [#33481](https://github.com/oven-sh/bun/pull/33481) `+420/-166` cov=86% — Read os.userInfo() from the passwd database
- [#33845](https://github.com/oven-sh/bun/pull/33845) `+387/-87` cov=83% — io: propagate IoRequestLoop init failure instead of aborting
- [#33519](https://github.com/oven-sh/bun/pull/33519) `+313/-42` cov=75% — dns: honor the AI_V4MAPPED / AI_ALL hints on the c-ares backend
- [#34996](https://github.com/oven-sh/bun/pull/34996) `+88/-6` cov=100% — node:os: fix setPriority() error syscall name and EPERM errno
- [#32310](https://github.com/oven-sh/bun/pull/32310) `+106/-4` cov=100% — sys(fd): anchor EBADF debug stack trace at close() caller
- [#31165](https://github.com/oven-sh/bun/pull/31165) `+42/-1` cov=100% — sys: drop with_fd debug assertion on Fd::INVALID

### crash-handler — crash handler, panic
_working knowledge · 14 PRs total, 8 above threshold_

- [#31691](https://github.com/oven-sh/bun/pull/31691) `+164/-9` cov=100% — Fix `--watch` reload panic when the executable has been deleted or replaced
- [#30980](https://github.com/oven-sh/bun/pull/30980) `+42/-1` cov=100% — Bun__inspect: don't panic when user JS throws during error-message formatting
- [#30663](https://github.com/oven-sh/bun/pull/30663) `+32/-1` cov=100% — Fix crash in Bun.openInEditor when options is not an object
- [#35305](https://github.com/oven-sh/bun/pull/35305) `+86/-8` cov=100% — crash_handler: make setDlOpenAction nesting-safe
- [#34772](https://github.com/oven-sh/bun/pull/34772) `+151/-23` cov=100% — crash_handler: classify guard-page SIGSEGV/SIGBUS as StackOverflow on POSIX
- [#32871](https://github.com/oven-sh/bun/pull/32871) `+297/-28` cov=100% — crash_handler: recover the immediate caller when a frameless leaf faults
- [#30792](https://github.com/oven-sh/bun/pull/30792) `+308/-5` cov=100% — dispatch: compile-time row-count assert + debug-panic on the fs-async wildcard
- [#32131](https://github.com/oven-sh/bun/pull/32131) `+324/-35` cov=67% — Fix crash when uploading a locked ReadableStream to S3

---

## oven-sh/WebKit

### intl — Intl.*, ICU
_core ownership · 9 PRs total, 5 above threshold_

- [#227](https://github.com/oven-sh/WebKit/pull/227) `+17/-4` cov=100% — Intl: accept legacy IANA primary zones (CET, CST6CDT, EET, EST5EDT, MET, MST7MDT, PST8PDT, WET) _(also: runtime)_
- [#373](https://github.com/oven-sh/WebKit/pull/373) `+5/-1` cov=50% — Intl.DateTimeFormat: do not set [[DayPeriod]] from the AM/PM pattern field _(also: runtime)_
- [#365](https://github.com/oven-sh/WebKit/pull/365) `+16/-1` cov=0% — IntlCollator: honor locale-tailored caseFirst default (da, mt) _(also: runtime)_
- [#351](https://github.com/oven-sh/WebKit/pull/351) `+9/-1` cov=0% — IntlLocale: normalize ICU's "yes" sentinel in keywordValue; scope "true"->"" to kf _(also: runtime)_
- [#350](https://github.com/oven-sh/WebKit/pull/350) `+7/-2` cov=0% — IntlLocale: throw RangeError (not TypeError) when ICU canonicalization fails on a structurally valid tag _(also: runtime)_

### date — JSDateMath, Date, tzdata
_core ownership · 1 PRs total, 1 above threshold_

- [#325](https://github.com/oven-sh/WebKit/pull/325) `+53/-0` cov=33% — DateCache: resolve the Date.toString() zone name at the instant via udat_format _(also: runtime)_

### cached-types — CachedTypes, bytecode cache
_core ownership · 2 PRs total, 2 above threshold_

- [#368](https://github.com/oven-sh/WebKit/pull/368) `+75/-0` cov=50% — CachedTypes: reject out-of-range offsets instead of reading past the buffer _(also: runtime)_
- [#346](https://github.com/oven-sh/WebKit/pull/346) `+10/-23` cov=50% — SourceCodeKey: restore source string comparison in operator== _(also: runtime)_

### build-config — CI/build config, LLVM, ICU data
_core ownership · 8 PRs total, 8 above threshold_

- [#139](https://github.com/oven-sh/WebKit/pull/139) `+21/-19` cov=100% — Upgrade CI to LLVM 20 (21 for Windows ARM64) and Alpine 3.23
- [#297](https://github.com/oven-sh/WebKit/pull/297) `+36/-9` cov=100% — parser: make stack-overflow failure sticky across save-point backtracking
- [#137](https://github.com/oven-sh/WebKit/pull/137) `+73/-11` cov=100% — Add baseline x64 Linux builds for CPUs without AVX
- [#296](https://github.com/oven-sh/WebKit/pull/296) `+136/-53` cov=64% — Upgrade LLVM toolchain from 21.1.8 to 22.1.8
- [#374](https://github.com/oven-sh/WebKit/pull/374) `+70/-5` cov=33% — ICU: backport ICU-23110 (percent formatRange scaled twice on approximately path) _(also: intl)_
- [#358](https://github.com/oven-sh/WebKit/pull/358) `+62/-6` cov=25% — ICU: overlay current IANA tzdata (2026c) onto the data package _(also: intl, date)_
- [#226](https://github.com/oven-sh/WebKit/pull/226) `+219/-4` cov=17% — win: release physical pages in vmDeallocatePhysicalPages + hintMemoryNotNeededSoon _(also: bmalloc, wtf)_
- [#222](https://github.com/oven-sh/WebKit/pull/222) `+174/-0` cov=20% — Fix JSGlobalContextRelease abort on VM shutdown with a private atom string table _(also: runtime)_

### dfg — DFG JIT
_strong familiarity · 7 PRs total, 4 above threshold_

- [#318](https://github.com/oven-sh/WebKit/pull/318) `+111/-52` cov=100% — DFG DOMJIT: fix attemptToMakeCallDOM predicates and restore typed-array/Int52 lowering
- [#207](https://github.com/oven-sh/WebKit/pull/207) `+7/-7` cov=100% — matchAll/replaceAll: clearer wording for non-global RegExp TypeError _(also: runtime)_
- [#335](https://github.com/oven-sh/WebKit/pull/335) `+101/-5` cov=67% — DFG: store OSREntryData::m_expectedValues sparsely
- [#294](https://github.com/oven-sh/WebKit/pull/294) `+454/-10` cov=54% — Add DFG/FTL intrinsics for DataView BigInt64/BigUint64 accessors _(also: runtime)_

### wtf — WTF
_strong familiarity · 7 PRs total, 1 above threshold_

- [#212](https://github.com/oven-sh/WebKit/pull/212) `+8/-2` cov=100% — StringImpl::costDuringGC: clamp refCount divisor to avoid SIGFPE

### runtime — JSC runtime (broad)
_strong familiarity · 38 PRs total, 14 above threshold_

- [#281](https://github.com/oven-sh/WebKit/pull/281) `+9/-3` cov=100% — JSModuleRecord::evaluate: resume suspended TLA body when a cycle sibling throws
- [#277](https://github.com/oven-sh/WebKit/pull/277) `+72/-6` cov=100% — JSC: route promise jobs to the handler/then realm's microtask queue
- [#154](https://github.com/oven-sh/WebKit/pull/154) `+51/-4` cov=100% — Fix O(n²) complexity for String.prototype.slice() on rope strings
- [#362](https://github.com/oven-sh/WebKit/pull/362) `+9/-13` cov=100% — BasicBlockLocation::getExecutedRanges: replace O(n^2) selection sort with std::sort
- [#353](https://github.com/oven-sh/WebKit/pull/353) `+58/-0` cov=100% — JSBigInt::parseInt: O(n) fast path for power-of-two radix
- [#268](https://github.com/oven-sh/WebKit/pull/268) `+19/-3` cov=100% — JSC: propagate async context through PromiseFinallyAwaitJob
- [#217](https://github.com/oven-sh/WebKit/pull/217) `+12/-0` cov=100% — module-loader: don't double-fire moduleRegistryModuleSettled after inline sync replay
- [#170](https://github.com/oven-sh/WebKit/pull/170) `+16/-0` cov=100% — fix(windows): use tryProtect in BufferMemoryHandle destructor to prevent mprotect crash _(also: build-config)_
- [#359](https://github.com/oven-sh/WebKit/pull/359) `+415/-7` cov=50% — [JSC] Implement Promise.allKeyed and Promise.allSettledKeyed behind usePromiseAllKeyed _(also: wtf)_
- [#371](https://github.com/oven-sh/WebKit/pull/371) `+12/-6` cov=75% — SynchronousModuleQueue: replay diverted reactions against their own realm
- [#323](https://github.com/oven-sh/WebKit/pull/323) `+55/-21` cov=67% — JITThunks: compile IC handler thunks lazily
- [#360](https://github.com/oven-sh/WebKit/pull/360) `+42/-0` cov=67% — String.prototype.localeCompare: cache IntlCollator for (string locale, no options) _(also: intl)_
- [#312](https://github.com/oven-sh/WebKit/pull/312) `+75/-0` cov=67% — Cache source constructor name across prototype transitions
- [#287](https://github.com/oven-sh/WebKit/pull/287) `+49/-11` cov=33% — Add VM::setDebuggerTrapCallback for runtime debugger activation _(also: inspector)_

### bytecode — bytecode, bytecompiler
_working knowledge · 4 PRs total, 1 above threshold_

- [#355](https://github.com/oven-sh/WebKit/pull/355) `+10/-0` cov=100% — bytecompiler: guard recursion in Array/ObjectPatternNode::bindValue
