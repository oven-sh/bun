# Yarn Berry (v2+) Migration - Implementation Plan

**Status**: Ready for Implementation  
**Priority**: Medium-High  
**Estimated Effort**: 11-17 days

---

## Quick Summary

Yarn Berry (v2+) uses a **completely different lockfile format** from v1:

- ✅ **Valid YAML** (use `bun.interchange.yaml.YAML`)
- ✅ **All deps have protocol prefixes** (`npm:`, `workspace:`, `patch:`, etc.)
- ✅ **Different integrity format** (`checksum: 10c0/hash`)
- ✅ **Virtual packages** for peer deps (can skip initially)
- ✅ **First-class patch support** (warn initially, full support later)

**Cannot reuse v1 parser.** Must implement from scratch.

---

## Implementation Strategy

### Phase 1: MVP (3-5 days)

**Goal:** Migrate basic Berry lockfiles

**Scope:**

- YAML parsing with `bun.interchange.yaml.YAML`
- `npm:` protocol support
- `workspace:` protocol support
- Multi-spec consolidation
- Checksum conversion (`10c0/hash` → `sha512-hash`)
- Basic dependency resolution

**Tests:** 1-4, 16-20 from test plan

**Files to create:**

- `src/install/yarn_berry.zig` - Main migration logic
- `test/cli/install/migration/yarn-berry/` - Test fixtures

### Phase 2: Common Protocols (2-3 days)

**Goal:** Support real-world cases

**Scope:**

- `link:`, `portal:`, `file:` protocols
- `git:`, `github:`, `https:` protocols
- HTTP(S) remote tarballs

**Tests:** 5-10 from test plan

### Phase 3: Advanced Features (4-6 days)

**Goal:** Full compatibility

**Scope:**

- `patch:` protocol (read `.yarn/patches/`)
- Virtual packages (flatten or full support)
- Resolutions/overrides
- Optional dependencies

**Tests:** 11-15 from test plan

### Phase 4: Polish (2-3 days)

**Goal:** Production ready

**Scope:**

- Error messages
- Edge cases
- Performance
- Documentation

---

## Key Technical Decisions

### 1. Version Support

**Decision:** Support Berry v6, v7, v8 only

```zig
if (lockfile_version < 6) {
    return error.YarnBerryVersionTooOld;
}
```

### 2. Virtual Packages

**Decision:** Skip virtual packages initially, use base packages

```zig
// Skip virtual package entries
if (strings.contains(entry_key, "@virtual:")) {
    continue;
}
```

**Rationale:** Virtual packages are Berry-specific optimization. Flattening to base packages works for most cases.

### 3. Patch Protocol

**Decision:** Warn and use base package in Phase 1, full support in Phase 3

```zig
if (strings.hasPrefix(protocol_part, "patch:")) {
    try log.addWarning(null, logger.Loc.Empty,
        "Patches not fully supported yet. Using base package.");

    // Extract and decode base package
    const base_descriptor = extractBasePatchDescriptor(protocol_part);
    const decoded = try urlDecode(base_descriptor, allocator);
    return parseResolution(decoded, allocator, string_buf);
}
```

### 4. Parsing Strategy

**Use Bun's YAML library:**

```zig
const yaml_source = &logger.Source.initPathString("yarn.lock", data);
const yaml = bun.interchange.yaml.YAML.parse(allocator, yaml_source, log) catch {
    return error.YarnBerryParseError;
};
defer yaml.deinit();

const root = yaml.root;
```

---

## Architecture Overview

```zig
pub fn migrateYarnBerryLockfile(
    lockfile: *Lockfile,
    manager: *PackageManager,
    allocator: std.mem.Allocator,
    log: *logger.Log,
    data: []const u8,
    dir: bun.FD,
) MigrateYarnBerryError!LoadResult {
    // Phase 1: Parse YAML
    const yaml = try parseYAML(data, allocator, log);

    // Phase 2: Extract & validate metadata
    const metadata = try extractMetadata(yaml);
    if (metadata.version < 6) return error.YarnBerryVersionTooOld;

    // Phase 3: Build workspace map
    const workspace_map = try buildWorkspaceMap(yaml, allocator);

    // Phase 4: Create root + workspace packages
    try createWorkspacePackages(lockfile, manager, workspace_map, ...);

    // Phase 5: Create regular packages
    try createRegularPackages(lockfile, yaml, workspace_map, ...);

    // Phase 6: Resolve dependencies
    try resolveDependencies(lockfile, pkg_map, ...);

    // Phase 7: Finalize (metadata fetch, sort, validate)
    try lockfile.resolve(log);
    try lockfile.fetchNecessaryPackageMetadataAfterYarnOrPnpmMigration(manager, true);

    return LoadResult{
        .ok = .{
            .lockfile = lockfile,
            .migrated = .yarn_berry,  // New enum value!
        },
    };
}
```

---

## Protocol Parsing Reference

```zig
fn parseResolution(
    resolution: []const u8,
    allocator: Allocator,
    string_buf: *StringBuf,
) !Resolution {
    // Format: "package-name@protocol:reference"

    const at_idx = strings.lastIndexOfChar(resolution, '@');
    const protocol_part = resolution[at_idx.? + 1..];

    if (strings.hasPrefix(protocol_part, "npm:")) {
        const version = protocol_part["npm:".len..];
        return .init(.{ .npm = .{
            .version = try Semver.parse(version, string_buf, allocator),
            .url = String.empty,
        }});
    } else if (strings.hasPrefix(protocol_part, "workspace:")) {
        const path = protocol_part["workspace:".len..];
        return .init(.{ .workspace = try string_buf.append(path) });
    } else if (strings.hasPrefix(protocol_part, "link:")) {
        const path = protocol_part["link:".len..];
        return .init(.{ .folder = try string_buf.append(path) });
    } else if (strings.hasPrefix(protocol_part, "file:")) {
        const path = protocol_part["file:".len..];
        if (strings.hasSuffix(path, ".tgz") or strings.hasSuffix(path, ".tar.gz")) {
            return .init(.{ .local_tarball = try string_buf.append(path) });
        } else {
            return .init(.{ .folder = try string_buf.append(path) });
        }
    } else if (strings.hasPrefix(protocol_part, "github:")) {
        // Parse: "github:user/repo#commit:hash"
        const content = protocol_part["github:".len..];
        const commit_idx = strings.indexOfChar(content, '#');

        if (commit_idx) |idx| {
            const repo = content[0..idx];
            const commit_part = content[idx + 1..];

            if (strings.hasPrefix(commit_part, "commit:")) {
                const commit = commit_part["commit:".len..];
                return .init(.{ .github = .{
                    .owner = try extractGitHubOwner(repo, string_buf),
                    .repo = try extractGitHubRepo(repo, string_buf),
                    .committish = try string_buf.append(commit),
                }});
            }
        }
    } else if (strings.hasPrefix(protocol_part, "git:")) {
        // Similar to github but with full URL
        // ...
    } else if (strings.hasPrefix(protocol_part, "https:") or
               strings.hasPrefix(protocol_part, "http:")) {
        return .init(.{ .remote_tarball = try string_buf.append(protocol_part) });
    }

    return error.UnknownProtocol;
}
```

---

## Checksum Conversion

```zig
fn parseChecksum(
    entry_obj: JSAst.Expr.Object,
    cache_key: []const u8,
    allocator: Allocator,
    string_buf: *StringBuf,
) !Integrity {
    const checksum_expr = entry_obj.get("checksum") orelse {
        return Integrity{};
    };

    const checksum_str = checksum_expr.asString(allocator) orelse {
        return Integrity{};
    };

    // Unquote: "10c0/hash" -> 10c0/hash
    const checksum = if (strings.hasPrefix(checksum_str, "\""))
        checksum_str[1..checksum_str.len-1]
    else
        checksum_str;

    // Format: "10c0/base64hash"
    const slash_idx = strings.indexOfChar(checksum, '/');
    if (slash_idx == null) return Integrity{};

    const hash = checksum[slash_idx.? + 1..];

    // Convert to Bun format: "sha512-base64hash"
    const bun_integrity = try std.fmt.allocPrint(allocator, "sha512-{s}", .{hash});
    defer allocator.free(bun_integrity);

    return Integrity.parse(bun_integrity, string_buf) catch Integrity{};
}
```

---

## Test Plan Summary

### Must Have (Phase 1)

1. Simple npm dependencies
2. Workspace dependencies
3. Multi-spec consolidation
4. Scoped packages

### Should Have (Phase 2)

5. Link protocol
6. Portal protocol
7. File dependencies
8. Git dependencies
9. GitHub shorthand
10. HTTPS remote tarballs

### Nice to Have (Phase 3)

11. Patch protocol (full support)
12. Virtual packages (flatten or full)
13. Resolutions/overrides
14. Optional dependencies
15. Peer dependencies

### Edge Cases (Phase 4)

16. URL encoding in patches
17. Very long package names
18. Mixed protocols
19. Missing fields
20. Invalid lockfile version

---

## File Structure

```
src/install/
  yarn_berry.zig          # NEW: Berry migration logic
  yarn.zig                # Existing v1 migration
  migration.zig           # Update to detect Berry vs v1

test/cli/install/migration/
  yarn-berry/             # NEW: Berry test fixtures
    basic/
      package.json
      yarn.lock
    workspaces/
      package.json
      yarn.lock
      packages/lib/package.json
    patches/
      package.json
      yarn.lock
      .yarn/patches/...
    protocols/
      package.json
      yarn.lock
  yarn-berry-migration.test.ts  # NEW: Berry migration tests
```

---

## Changes Needed in Existing Code

### 1. migration.zig

```zig
yarn: {
    const lockfile = File.openat(dir, "yarn.lock", bun.O.RDONLY, 0).unwrap() catch break :yarn;
    defer lockfile.close();
    const data = lockfile.readToEnd(allocator).unwrap() catch break :yarn;

    // Detect Berry vs v1
    const is_berry = strings.contains(data, "__metadata:") or
                     (!strings.hasPrefixComptime(data, "# yarn lockfile v1") and
                      !strings.hasPrefixComptime(data, "# THIS IS AN AUTOGENERATED FILE"));

    const migrate_result = if (is_berry)
        @import("./yarn_berry.zig").migrateYarnBerryLockfile(this, manager, allocator, log, data, dir)
    else
        @import("./yarn.zig").migrateYarnLockfile(this, manager, allocator, log, data, dir);

    // ... rest of error handling
}
```

### 2. lockfile.zig (LoadResult enum)

```zig
migrated: enum { none, npm, yarn, yarn_berry, pnpm } = .none,
```

### 3. analytics

```zig
bun.analytics.Features.yarn_berry_migration += 1;
```

---

## Migration Comparison Table

| Feature    | Yarn v1                 | Yarn Berry                  | Bun.lock      |
| ---------- | ----------------------- | --------------------------- | ------------- |
| Format     | YAML-like               | YAML                        | JSONC         |
| Parser     | Custom                  | `bun.interchange.yaml.YAML` | JSON          |
| Protocols  | Implicit                | Explicit (always)           | Mixed         |
| Integrity  | `integrity: sha512-...` | `checksum: 10c0/...`        | `sha512-...`  |
| Workspaces | Unreliable markers      | `@workspace:` protocol      | Path-based    |
| Patches    | Not supported           | `patch:` protocol           | Patches field |
| Peer deps  | Not recorded            | Recorded + virtual          | Recorded      |

---

## Success Criteria

### Functional

- ✅ All packages from yarn.lock present in bun.lock
- ✅ All dependencies resolve correctly
- ✅ Workspaces structure preserved
- ✅ Integrity hashes preserved
- ✅ Binary scripts preserved

### Quality

- ✅ 20+ test cases passing
- ✅ Real-world projects tested (Babel, Jest, etc.)
- ✅ Edge cases handled gracefully

### Performance

- ✅ Migration <5s for typical projects
- ✅ Memory usage <500MB for large monorepos

### UX

- ✅ Clear error messages
- ✅ Helpful warnings for unsupported features
- ✅ Documentation for migration process

---

## Risk Assessment

### High Risk

- **Virtual packages complexity** → Mitigation: Skip initially, flatten to base
- **Patch protocol edge cases** → Mitigation: Warn initially, full support later
- **URL encoding bugs** → Mitigation: Extensive test coverage

### Medium Risk

- **YAML parsing edge cases** → Mitigation: Use Bun's tested YAML library
- **Protocol variations** → Mitigation: Incremental implementation
- **Large lockfile performance** → Mitigation: Profile and optimize

### Low Risk

- **Basic npm: protocol** → Well understood, similar to v1
- **Workspace handling** → Can reuse v1 logic
- **Checksum conversion** → Simple string manipulation

---

## Next Steps

1. **Read full research doc** (`YARN_BERRY_RESEARCH.md`)
2. **Create basic test fixtures** in `test/cli/install/migration/yarn-berry/`
3. **Implement Phase 1 MVP** in `src/install/yarn_berry.zig`
4. **Test with real projects** (create test fixtures from actual projects)
5. **Iterate** based on test results
6. **Implement Phase 2-4** progressively

---

## Questions to Resolve

1. **Should we support Berry v5 and below?** → Recommend NO (too different)
2. **Full virtual package support or flatten?** → Recommend FLATTEN initially
3. **Full patch support or warn?** → Recommend WARN in Phase 1, full in Phase 3
4. **Support exec: protocol?** → Recommend NO (very rare, Bun doesn't support)
5. **Performance targets?** → Recommend <5s for typical, <30s for large monorepos

---

## Resources

- **Full research**: `YARN_BERRY_RESEARCH.md` (118 KB, comprehensive)
- **Yarn docs**: https://yarnpkg.com/
- **Berry source**: https://github.com/yarnpkg/berry
- **Existing v1 code**: `src/install/yarn.zig`
- **Bun YAML library**: `bun.interchange.yaml.YAML`

---

**Ready to implement!** Start with Phase 1 MVP. 🚀
