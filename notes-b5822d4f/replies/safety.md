Follow-up in e3553793d7. The five sites now state only that the storage is disjoint. The sentence about what the callee does with `manager` is gone at each of them.

I did not keep "never re-projects `manager.lockfile`". That clause is not true for a migration of yarn.lock or pnpm-lock.yaml: `fetch_necessary_package_metadata_after_yarn_or_pnpm_migration` calls `populate_manifest_cache`, which reads the lockfile through `manager.lockfile` (`src/install/PackageManager/PopulateManifestCache.rs:144`). That read is on main, and this PR does not change it. #44304 tracks it.
