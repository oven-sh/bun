# Measurements (base = origin/main a4f1429148, PR = 04f38c0d8d)

1. record_npm_alias calls (gdb breakpoints, debug builds):
   - bench/bundle (bun.lockb, 102 dependency rows, 100 npm: rows): `bun pm hash` 100 -> 0, map grows 5 -> 0; `bun install --dry-run` 300 -> 300 (100 of them now from the pass over the kept rows).
   - bun.lock with 50 flat alias overrides: `bun pm hash` 50 -> 0, grows 4 -> 0; `bun install --dry-run` 150 -> 100.
2. instructions (gdb stepi, release profile builds):
   - buffers::load, bench/bundle, `bun pm hash`: 169,808 -> 112,392.
   - kept bun.lockb, bench/bundle (100 alias rows), `bun install --dry-run`: buffers::load 169,906 -> 111,110, the new pass 152,360. Net +93,564, about +940 for each alias row.
   - kept bun.lockb, bench/express (146 rows, no alias), `bun install --dry-run`: buffers::load 134,960 -> 134,088, the new pass 1,046. Net +174.
3. hot paths (objdump of release builds): enqueue_dependency_with_main_and_success_fn 4095 instructions, 0 changed; parse_with_tag 956 instructions, 0 changed.
   No-op install instruction count: not measured. perf and valgrind cannot be installed here (apt has no source for them, perf_event_paranoid=4). A gdb stepi count of the bun.lock load of bench/install did not finish in 40 minutes.
4. release sizes (size -A, nm -S): .text 58,143,477 -> 58,143,733 (+256 bytes). New: record_npm_aliases 437 bytes, record_override_and_catalog_aliases 193 bytes.
   put_lockfile_rule 3335 -> 3227; buffers::load 4510 -> 4490; parse_into_binary_lockfile 48463 -> 48233; Lockfile::load_from_bytes 11263 -> 11150; install_with_manager 42089 -> 42164; runtime init closure 10630 -> 10703.
5. kept lockfile matrix (release builds): 112 cells = {bun.lock, bun.lockb, package-lock.json, yarn.lock} x {root, workspace, transitive, scoped override (bun.lock, bun.lockb only)} x {install in sync, add kept@^1.0.0, add extra, update} x {5, 18 byte target}.
   changed: 6 of 112. package.json-declared (root, workspace) cells changed: 0 of 64. transitive cells of bun.lockb and package-lock.json changed: 0 of 16. bun.lock cells changed: 0 of 32.
   - bun.lockb scoped override, add kept@^1.0.0 and add extra (4 cells): the new plain edge gets the registry package of its name, the parent keeps the alias target. Same rows as bun.lock. Requests: /kept in place of the alias target. +1 package.
   - yarn.lock transitive, 18 byte target, add kept@^1.0.0 and add extra (2 cells): exit 1 (`GET <registry>/alias-some-other-p - 404`, `kept@^1.0.0 failed to resolve`) -> exit 0 with the rows that the 5 byte target gets on main.
   npm 11.16.0 for the scoped override edits (run on the first shape of this branch): add kept@^1.0.0 -> kept@1.0.0 at the root; add extra -> extra's kept takes the package that is installed as `kept`.
6. runtime init (bun.lockb with 2 root alias rows and 2 transitive alias rows, `bun --install=fallback index.js`, debug builds): record_npm_alias 6 -> 6 (4 from the passes), each pass runs 1 time. Without bun.lockb: 2 -> 2, passes entered 0 times. bun.lockb that fails to load: 6 -> 2, passes entered 0 times.
