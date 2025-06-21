# Implementation Plan for `bun audit fix`

## Overview

Based on analysis of the Bun codebase, implementing `bun audit fix` would require several components to work together to automatically fix vulnerabilities by updating packages to the minimum safe version.

## Current State

The current `bun audit` command:

1. Collects installed packages from the lockfile
2. Sends them to NPM's bulk advisory endpoint
3. Receives vulnerability information including:
   - `vulnerable_versions` - a semver range like "<0.7.0" or ">=1.0.0 <1.4.1"
   - `severity` - critical, high, moderate, low
   - Package name and other metadata

## Implementation Architecture

### 1. Add `--fix` Flag to Audit Command

In `src/install/PackageManager/CommandLineArguments.zig`, add support for a `--fix` flag:

```zig
pub const audit_params = clap.parseParamsComptime(
    \\--json             Return audit results as JSON
    \\--fix              Automatically fix vulnerabilities by updating packages
    \\
);
```

### 2. Parse Vulnerable Version Ranges

The vulnerability response includes `vulnerable_versions` as a string. We need to:

1. Parse this as a semver range using the existing `Semver.Query.parse()` function
2. Determine the minimum version that does NOT satisfy the vulnerable range

### 3. Find Minimum Safe Version

Create a function to find the minimum safe version from available versions:

```zig
fn findMinimumSafeVersion(
    vulnerable_range: Semver.Query.Group,
    available_versions: []const Semver.Version,
    string_buf: []const u8,
) ?Semver.Version {
    // Sort versions if not already sorted
    // Find the first version that does NOT satisfy vulnerable_range
    for (available_versions) |version| {
        if (!vulnerable_range.satisfies(version, string_buf, string_buf)) {
            return version;
        }
    }
    return null;
}
```

### 4. Create Update Requests

For each vulnerable package, create an `UpdateRequest` with the minimum safe version:

```zig
fn createAuditFixUpdateRequests(
    allocator: std.mem.Allocator,
    audit_result: *const AuditResult,
    pm: *PackageManager,
) ![]UpdateRequest {
    var updates = std.ArrayList(UpdateRequest).init(allocator);

    var iter = audit_result.vulnerable_packages.iterator();
    while (iter.next()) |entry| {
        const package_info = entry.value_ptr;
        const package_name = package_info.name;

        // Parse vulnerable version range
        for (package_info.vulnerabilities.items) |vuln| {
            const vulnerable_range = try Semver.Query.parse(
                allocator,
                vuln.vulnerable_versions,
                SlicedString.init(vuln.vulnerable_versions, vuln.vulnerable_versions),
            );

            // Find available versions for this package
            // Query registry or use cached manifest
            const manifest = try fetchPackageManifest(pm, package_name);
            const safe_version = findMinimumSafeVersion(
                vulnerable_range,
                manifest.versions,
                manifest.string_buf,
            );

            if (safe_version) |version| {
                try updates.append(.{
                    .name = package_name,
                    .name_hash = String.Builder.stringHash(package_name),
                    .version = .{
                        .literal = try std.fmt.allocPrint(allocator, "{}", .{version}),
                        .value = .{ .npm = .{ .version = version } },
                        .tag = .npm,
                    },
                });
            }
        }
    }

    return updates.toOwnedSlice();
}
```

### 5. Integrate with Package Update System

Modify the audit command to use the existing update infrastructure:

```zig
pub fn audit(ctx: Command.Context, pm: *PackageManager, json_output: bool, fix: bool) !u32 {
    // ... existing audit code ...

    const audit_result = try parseAuditResponse(allocator, response_text, pm, dependency_tree);

    if (fix and audit_result.all_vulnerabilities.items.len > 0) {
        // Create update requests for vulnerable packages
        const update_requests = try createAuditFixUpdateRequests(allocator, &audit_result, pm);

        // Use existing update infrastructure
        try pm.updatePackageJSONAndInstallWithManagerWithUpdatesAndUpdateRequests(
            ctx,
            update_requests,
            .update,  // Use update subcommand behavior
            original_cwd,
        );

        Output.prettyln("<green>Fixed {d} vulnerabilities<r>", .{update_requests.len});
        return 0;
    }

    // ... existing reporting code ...
}
```

### 6. Handle Edge Cases

1. **No safe version available**: If all versions satisfy the vulnerable range, report that the package cannot be automatically fixed
2. **Breaking changes**: Respect existing version constraints in package.json when possible
3. **Transitive dependencies**: May need to update parent packages if the vulnerable package is not a direct dependency
4. **Multiple vulnerabilities**: If a package has multiple vulnerabilities, find a version that fixes all of them

### 7. Testing

Create test fixtures similar to those in `test/cli/install/bun-audit.test.ts`:

- Test fixing direct dependencies
- Test fixing transitive dependencies
- Test when no safe version exists
- Test with multiple vulnerabilities per package
- Test preserving version constraints (^, ~)

## Alternative Approach: Minimal Changes

A simpler initial implementation could:

1. Run `bun audit` to identify vulnerable packages
2. For each directly vulnerable package, run `bun update <package>`
3. Re-run audit to verify fixes

This would be less precise but could serve as an MVP.

## Summary

The implementation would leverage existing infrastructure:

- Semver parsing and range checking from `src/semver/`
- Update request handling from `src/install/`
- Package manifest fetching from `src/install/npm.zig`
- Package.json editing from `src/install/PackageManager/PackageJSONEditor.zig`

The main new logic would be:

1. Parsing vulnerable version ranges
2. Finding minimum safe versions
3. Creating targeted update requests
4. Integrating with the existing update flow
