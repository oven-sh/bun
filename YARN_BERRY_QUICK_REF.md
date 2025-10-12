# Yarn Berry Quick Reference

## Version Detection

```zig
// Yarn v1
if (strings.hasPrefixComptime(data, "# yarn lockfile v1"))

// Yarn Berry (v2+)
if (strings.contains(data, "__metadata:"))
```

## Entry Format

```yaml
"package@npm:^1.0.0, package@npm:~1.0.0":
  version: 1.2.3
  resolution: "package@npm:1.2.3"
  dependencies:
    dep: "npm:^2.0.0"
  checksum: 10c0/base64hash...
  languageName: node
  linkType: hard
```

## Protocols Cheat Sheet

| Protocol | Example | Maps to Bun |
|----------|---------|-------------|
| `npm:` | `"pkg@npm:1.0.0"` | `npm` resolution |
| `workspace:` | `"pkg@workspace:."` | `workspace` resolution |
| `patch:` | `"pkg@patch:pkg@npm%3A1.0.0#..."` | Skip or read patches |
| `link:` | `"pkg@link:../pkg"` | `folder` resolution |
| `portal:` | `"pkg@portal:../pkg"` | `folder` resolution |
| `file:` | `"pkg@file:../pkg.tgz"` | `local_tarball` or `folder` |
| `git:` | `"pkg@git://github.com/u/r#commit:abc"` | `git` resolution |
| `github:` | `"pkg@github:u/r#commit:abc"` | `github` resolution |
| `https:` | `"pkg@https://example.com/pkg.tgz"` | `remote_tarball` |

## Checksum Conversion

```zig
// Berry: "10c0/base64hash"
// Bun:   "sha512-base64hash"

const slash_idx = strings.indexOfChar(checksum, '/');
const hash = checksum[slash_idx + 1..];
const bun_integrity = try std.fmt.allocPrint(allocator, "sha512-{s}", .{hash});
```

## Resolution Parsing

```zig
// Input: "lodash@npm:4.17.21"
const at_idx = strings.lastIndexOfChar(resolution, '@');
const pkg_name = resolution[0..at_idx.?];        // "lodash"
const protocol_part = resolution[at_idx.? + 1..]; // "npm:4.17.21"

if (strings.hasPrefix(protocol_part, "npm:")) {
    const version = protocol_part["npm:".len..]; // "4.17.21"
    // Create npm resolution
}
```

## Multi-Spec Parsing

```zig
// Input: "pkg@npm:^1.0.0, pkg@npm:~1.0.0"
const specs = std.mem.split(u8, entry_key, ", ");
while (specs.next()) |spec| {
    // Parse each spec
}
```

## Workspace Detection

```yaml
"my-app@workspace:.":
  resolution: "my-app@workspace:."
  linkType: soft

"my-lib@workspace:packages/lib":
  resolution: "my-lib@workspace:packages/lib"
  linkType: soft
```

```zig
if (strings.contains(resolution, "@workspace:")) {
    const ws_path = ...; // Extract path after "workspace:"
    // Create workspace package
}
```

## Virtual Package Detection

```yaml
"pkg@virtual:abc123#npm:1.0.0":
  # This is a virtual package
```

```zig
// Skip virtual packages initially
if (strings.contains(entry_key, "@virtual:")) {
    continue;
}
```

## Patch Protocol Parsing

```yaml
"pkg@patch:pkg@npm%3A1.0.0#~/.yarn/patches/pkg-npm-1.0.0-abc.patch::locator=app%40workspace%3A.":
```

```zig
// URL-encoded base: "pkg@npm%3A1.0.0"
// Decode: "pkg@npm:1.0.0"

const patch_content = protocol_part["patch:".len..];
const hash_idx = strings.indexOfChar(patch_content, '#');
const base_descriptor = patch_content[0..hash_idx.?];
const decoded = try urlDecode(base_descriptor, allocator);
```

## Common Patterns

### Parsing YAML
```zig
const yaml_source = &logger.Source.initPathString("yarn.lock", data);
const yaml = bun.interchange.yaml.YAML.parse(allocator, yaml_source, log) catch {
    return error.YarnBerryParseError;
};
defer yaml.deinit();
```

### Extracting Metadata
```zig
const metadata = yaml.root.data.e_object.get("__metadata") orelse {
    return error.MissingMetadata;
};
const version = metadata.data.e_object.get("version");
const cache_key = metadata.data.e_object.get("cacheKey");
```

### Iterating Entries
```zig
for (yaml.root.data.e_object.properties.slice()) |prop| {
    const key = prop.key.?.asString(allocator) orelse continue;
    if (strings.eqlComptime(key, "__metadata")) continue;
    
    const entry = prop.value.?.data.e_object;
    // Process entry
}
```

### Getting Entry Fields
```zig
const version = entry.get("version").?.asString(allocator);
const resolution = entry.get("resolution").?.asString(allocator);
const checksum = entry.get("checksum").?.asString(allocator);
const linkType = entry.get("linkType").?.asString(allocator);
const deps = entry.get("dependencies"); // May be null
```

## Error Messages

```zig
// Version too old
try log.addErrorFmt(null, logger.Loc.Empty, allocator,
    "Yarn Berry lockfile version {d} is too old. Please upgrade to v6+.",
    .{lockfile_version});

// Patch not supported
try log.addWarning(null, logger.Loc.Empty,
    "Patch protocol not fully supported yet. Using base package.");

// Virtual package skipped
try log.addWarning(null, logger.Loc.Empty,
    "Virtual packages are not supported yet. Using base package.");
```

## Test Fixture Format

```
test/cli/install/migration/yarn-berry/
  basic/
    package.json
    yarn.lock
  workspaces/
    package.json
    yarn.lock
    packages/
      lib/package.json
```

## MVP Implementation Checklist

- [ ] Parse YAML with `bun.interchange.yaml.YAML`
- [ ] Extract `__metadata` and validate version ≥ 6
- [ ] Parse `npm:` protocol
- [ ] Parse `workspace:` protocol
- [ ] Handle multi-spec entries
- [ ] Convert checksums (`10c0/hash` → `sha512-hash`)
- [ ] Skip virtual packages
- [ ] Warn for patch protocol
- [ ] Parse dependencies (with protocol prefixes!)
- [ ] Create root + workspace packages
- [ ] Create regular packages
- [ ] Resolve dependencies
- [ ] Fetch metadata (os/cpu)
- [ ] Write tests

## Common Gotchas

1. **All deps have protocols** - Don't forget to strip protocol prefix when parsing version
2. **Unquote strings** - YAML strings may be quoted: `"npm:1.0.0"` → `npm:1.0.0`
3. **URL encoding in patches** - `@` → `%40`, `:` → `%3A`
4. **Virtual packages** - Skip entries with `@virtual:` in key
5. **Workspace paths** - May be `.` (root) or `packages/lib`
6. **Resolution field** - Always has format `"pkg@protocol:version"`
7. **LinkType** - `soft` = workspace/link/portal, `hard` = real package
8. **Multi-spec keys** - Split by `, ` (comma-space)

## Key Differences from v1

| Aspect | v1 | Berry |
|--------|----|----|
| Parser | Custom | YAML library |
| Format | YAML-like | Valid YAML |
| Protocols | Implicit | Explicit |
| Entry key | `"pkg@^1.0.0"` | `"pkg@npm:^1.0.0"` |
| Integrity | `integrity:` | `checksum:` |
| Workspace | Unreliable | `@workspace:` |

## Reusable from v1

- Workspace glob matching
- Package.json reading
- bun.lock generation
- Dependency resolution architecture
- String buffer management
- Metadata fetching (os/cpu)
