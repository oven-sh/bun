# Nested Overrides and Resolutions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add support for npm-style nested overrides and Yarn-style path resolutions so that package overrides can be scoped to a specific parent package rather than applied globally.

**Architecture:** Extend `OverrideMap` from a single flat map to a two-map structure (global + scoped). Thread parent `PackageID` context through the dependency enqueue and resolution pipeline so that `OverrideMap.get()` can look up scoped overrides. Update parsing, lockfile serialization, diffing, and cloning to handle scoped entries.

**Tech Stack:** Zig (runtime/lockfile), TypeScript (tests), Bun test runner

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/install/lockfile/OverrideMap.zig` | Core data model: two maps, get with parent, parse, clone, sort, count, deinit |
| `src/install/PackageManager/PackageManagerEnqueue.zig` | Override lookup call site: pass parent_package_id to `get()` |
| `src/install/PackageManager/PackageManagerResolution.zig` | `enqueueDependencyList` call sites: pass parent package id |
| `src/install/PackageManager/install_with_manager.zig` | Root enqueue: pass null parent; overrides count/clone |
| `src/install/PackageManager/processDependencyList.zig` | dependency_list_queue writes: include owner package_id |
| `src/install/PackageManager/runTasks.zig` | doFlushDependencyQueue: read owner-aware queue items |
| `src/install/lockfile.zig` | Scratch.DependencyQueue type change; clone overrides |
| `src/install/lockfile/Package.zig` | overrides_changed diff logic |
| `src/install/lockfile/bun.lockb.zig` | Binary lockfile read/write for scoped overrides |
| `src/install/lockfile/bun.lock.zig` | Text lockfile read/write for scoped overrides |
| `test/cli/install/overrides.test.ts` | Integration tests for nested overrides and resolutions |

---

### Task 1: Add scoped map data structure to OverrideMap

**Files:**
- Modify: `src/install/lockfile/OverrideMap.zig:1-6`

**What:** Add a second `scoped` map alongside the existing `map` (renamed to `global`), plus the `ScopedOverrideKey` type.

- [ ] **Step 1: Add the `ScopedOverrideKey` struct and `scoped` map field to OverrideMap**

In `src/install/lockfile/OverrideMap.zig`, change the top of the file from:

```zig
const OverrideMap = @This();

const debug = Output.scoped(.OverrideMap, .visible);

map: std.ArrayHashMapUnmanaged(PackageNameHash, Dependency, ArrayIdentityContext.U64, false) = .{},
```

to:

```zig
const OverrideMap = @This();

const debug = Output.scoped(.OverrideMap, .visible);

pub const ScopedOverrideKey = extern struct {
    parent_name_hash: PackageNameHash,
    child_name_hash: PackageNameHash,
};

pub const ScopedOverrideContext = struct {
    pub fn hash(self: @This(), key: ScopedOverrideKey) u32 {
        _ = self;
        return @truncate(@as(u64, key.parent_name_hash) * 33 +% @as(u64, key.child_name_hash));
    }

    pub fn eql(self: @This(), a: ScopedOverrideKey, b: ScopedOverrideKey) bool {
        _ = self;
        return a.parent_name_hash == b.parent_name_hash and a.child_name_hash == b.child_name_hash;
    }
};

global: std.ArrayHashMapUnmanaged(PackageNameHash, Dependency, ArrayIdentityContext.U64, false) = .{},
scoped: std.ArrayHashMapUnmanaged(ScopedOverrideKey, Dependency, ScopedOverrideContext, false) = .{},
```

Also add `usingnamespace` for the `ArrayIdentityContext` import — it is already imported at the bottom of the file.

**Important:** The existing code references `this.map` throughout the file. Every reference must be changed to `this.global`. This is a mechanical rename.

- [ ] **Step 2: Rename all `this.map` references to `this.global` in OverrideMap.zig**

In `src/install/lockfile/OverrideMap.zig`, replace every occurrence of `this.map` with `this.global`.

The places that reference it are:
- Line 5: the field declaration (already renamed above)
- Line 15: `this.map.count()` in `get()`
- Line 18: `this.map.get(name_hash)` in `get()`
- Line 41: `this.map.values().ptr` in `sort()`
- Line 44: `this.map.sort(&ctx)` in `sort()`
- Line 48: `this.map.deinit(allocator)` in `deinit()`
- Line 52: `this.map.values()` in `count()`
- Line 59: `new.map.ensureTotalCapacity(...)` in `clone()`
- Line 61: `this.map.keys(), this.map.values()` in `clone()`
- Line 62-64: `new.map.putAssumeCapacity(k, v)` in `clone()`
- Line 123: `this.map.entries.len` in `parseAppend()`
- Line 130: `this.map.entries.len` in `parseAppend()`
- Line 149: `this.map.ensureUnusedCapacity(...)` in `parseFromOverrides()`
- Line 205: `this.map.putAssumeCapacity(name_hash, version)` in `parseFromOverrides()`
- Line 226: `this.map.ensureUnusedCapacity(...)` in `parseFromResolutions()`
- Line 278: `this.map.putAssumeCapacity(name_hash, version)` in `parseFromResolutions()`

Use replace-all: `this.map` → `this.global` (be careful not to accidentally rename the new `ScopedOverrideContext` or other unrelated identifiers).

- [ ] **Step 3: Commit the data model change**

```bash
git add src/install/lockfile/OverrideMap.zig
git commit -m "refactor: rename OverrideMap.map to .global, add scoped map field"
```

---

### Task 2: Add parent-aware `get()` to OverrideMap

**Files:**
- Modify: `src/install/lockfile/OverrideMap.zig:7-22`

**What:** Replace the current `get(name_hash)` with `get(name_hash, parent_package_id, lockfile)` that checks scoped overrides first, then global.

- [ ] **Step 1: Replace the `get()` function**

In `src/install/lockfile/OverrideMap.zig`, replace the existing `get()` function:

```zig
/// In the future, this `get` function should handle multi-level resolutions. This is difficult right
/// now because given a Dependency ID, there is no fast way to trace it to its package.
///
/// A potential approach is to add another buffer to the lockfile that maps Dependency ID to Package ID,
/// and from there `OverrideMap.map` can have a union as the value, where the union is between "override all"
/// and "here is a list of overrides depending on the package that imported" similar to PackageIndex above.
pub fn get(this: *const OverrideMap, name_hash: PackageNameHash) ?Dependency.Version {
    debug("looking up override for {x}", .{name_hash});
    if (this.map.count() == 0) {
        return null;
    }
    return if (this.map.get(name_hash)) |dep|
        dep.version
    else
        null;
}
```

with:

```zig
pub fn get(this: *const OverrideMap, lockfile: *const Lockfile, name_hash: PackageNameHash, parent_package_id: ?PackageID) ?Dependency.Version {
    if (this.global.count() == 0 and this.scoped.count() == 0) {
        return null;
    }

    if (parent_package_id) |pid| {
        if (pid < lockfile.packages.len) {
            const parent_name_hash = lockfile.packages.items(.name_hash)[pid];
            if (this.scoped.get(.{ .parent_name_hash = parent_name_hash, .child_name_hash = name_hash })) |dep| {
                debug("scoped override: {x} under parent {x} -> {s}", .{ name_hash, parent_name_hash, lockfile.str(&dep.version.literal) });
                return dep.version;
            }
        }
    }

    return if (this.global.get(name_hash)) |dep|
        dep.version
    else
        null;
}
```

- [ ] **Step 2: Commit the get() change**

```bash
git add src/install/lockfile/OverrideMap.zig
git commit -m "feat: add parent-aware OverrideMap.get() with scoped override lookup"
```

---

### Task 3: Thread parent_package_id through the override lookup call site

**Files:**
- Modify: `src/install/PackageManager/PackageManagerEnqueue.zig:1-17` (enqueueDependencyWithMain)
- Modify: `src/install/PackageManager/PackageManagerEnqueue.zig:19-74` (enqueueDependencyList)
- Modify: `src/install/PackageManager/PackageManagerEnqueue.zig:444-453` (enqueueDependencyWithMainAndSuccessFn)
- Modify: `src/install/PackageManager/PackageManagerEnqueue.zig:489` (override lookup)

**What:** Add `parent_package_id: ?PackageID` parameter to `enqueueDependencyWithMain`, `enqueueDependencyList`, and `enqueueDependencyWithMainAndSuccessFn`. Pass it through to `OverrideMap.get()`.

- [ ] **Step 1: Update `enqueueDependencyWithMain` signature**

In `src/install/PackageManager/PackageManagerEnqueue.zig`, change:

```zig
pub fn enqueueDependencyWithMain(
    this: *PackageManager,
    id: DependencyID,
    /// This must be a *const to prevent UB
    dependency: *const Dependency,
    resolution: PackageID,
    install_peer: bool,
) !void {
    return this.enqueueDependencyWithMainAndSuccessFn(
        id,
        dependency,
        resolution,
        install_peer,
        assignResolution,
        null,
    );
}
```

to:

```zig
pub fn enqueueDependencyWithMain(
    this: *PackageManager,
    id: DependencyID,
    /// This must be a *const to prevent UB
    dependency: *const Dependency,
    resolution: PackageID,
    install_peer: bool,
    parent_package_id: ?PackageID,
) !void {
    return this.enqueueDependencyWithMainAndSuccessFn(
        id,
        dependency,
        resolution,
        install_peer,
        parent_package_id,
        assignResolution,
        null,
    );
}
```

- [ ] **Step 2: Update `enqueueDependencyWithMainAndSuccessFn` signature**

Change:

```zig
pub fn enqueueDependencyWithMainAndSuccessFn(
    this: *PackageManager,
    id: DependencyID,
    /// This must be a *const to prevent UB
    dependency: *const Dependency,
    resolution: PackageID,
    install_peer: bool,
    comptime successFn: SuccessFn,
    comptime failFn: ?FailFn,
) !void {
```

to:

```zig
pub fn enqueueDependencyWithMainAndSuccessFn(
    this: *PackageManager,
    id: DependencyID,
    /// This must be a *const to prevent UB
    dependency: *const Dependency,
    resolution: PackageID,
    install_peer: bool,
    parent_package_id: ?PackageID,
    comptime successFn: SuccessFn,
    comptime failFn: ?FailFn,
) !void {
```

- [ ] **Step 3: Update the override lookup in `enqueueDependencyWithMainAndSuccessFn`**

At line ~489, change:

```zig
            if (this.lockfile.overrides.get(name_hash)) |new| {
```

to:

```zig
            if (this.lockfile.overrides.get(this.lockfile, name_hash, parent_package_id)) |new| {
```

- [ ] **Step 4: Update `enqueueDependencyList` to accept and pass parent_package_id**

Change:

```zig
pub fn enqueueDependencyList(
    this: *PackageManager,
    dependencies_list: Lockfile.DependencySlice,
) void {
```

to:

```zig
pub fn enqueueDependencyList(
    this: *PackageManager,
    dependencies_list: Lockfile.DependencySlice,
    parent_package_id: ?PackageID,
) void {
```

And in the body, change the `enqueueDependencyWithMain` call from:

```zig
        this.enqueueDependencyWithMain(
            i,
            &dependency,
            resolution,
            false,
        ) catch |err| {
```

to:

```zig
        this.enqueueDependencyWithMain(
            i,
            &dependency,
            resolution,
            false,
            parent_package_id,
        ) catch |err| {
```

- [ ] **Step 5: Commit the signature threading**

```bash
git add src/install/PackageManager/PackageManagerEnqueue.zig
git commit -m "feat: thread parent_package_id through enqueueDependency functions"
```

---

### Task 4: Update all `enqueueDependencyList` and `enqueueDependencyWithMain` call sites

**Files:**
- Modify: `src/install/PackageManager/PackageManagerResolution.zig:123,127`
- Modify: `src/install/PackageManager/install_with_manager.zig:494`
- Modify: `src/install/PackageManager/PackageManagerEnqueue.zig:697,1047`
- Modify: `src/install/PackageManager/processDependencyList.zig:146,204`
- Modify: `src/install/PackageManager/runTasks.zig:1100-1111`

**What:** Every call site must now pass the appropriate `parent_package_id`. Root-level calls pass `null`. Package-level calls pass the package's own `PackageID`.

- [ ] **Step 1: Update root-level enqueue in install_with_manager.zig**

At `src/install/PackageManager/install_with_manager.zig:494`, change:

```zig
        manager.enqueueDependencyList(root.dependencies);
```

to:

```zig
        manager.enqueueDependencyList(root.dependencies, null);
```

- [ ] **Step 2: Update folder resolution enqueue in PackageManagerResolution.zig**

At `src/install/PackageManager/PackageManagerResolution.zig:123` and `127`, change:

```zig
                    this.enqueueDependencyList(this.lockfile.packages.items(.dependencies)[id]);
```

to:

```zig
                    this.enqueueDependencyList(this.lockfile.packages.items(.dependencies)[id], id);
```

(both the `new_package_id` and `package_id` branches, at lines 123 and 127).

- [ ] **Step 3: Update the dependency_list_queue writes in processDependencyList.zig to use owner-aware queue**

This is the most important change. The `dependency_list_queue` currently stores `DependencySlice` (which is just offset+length, no owner). We need it to carry the owning `PackageID` too.

First, update the queue type in `src/install/lockfile.zig`. At line ~1566, change:

```zig
    pub const DependencyQueue = bun.LinearFifo(DependencySlice, .Dynamic);
```

to:

```zig
    pub const DependencyListWithOwner = struct {
        package_id: PackageID,
        dependencies: DependencySlice,
    };

    pub const DependencyQueue = bun.LinearFifo(DependencyListWithOwner, .Dynamic);
```

Then, update the write sites in `src/install/PackageManager/processDependencyList.zig`. At lines 146 and 204, change:

```zig
                bun.handleOom(manager.lockfile.scratch.dependency_list_queue.writeItem(package.dependencies));
```

to:

```zig
                bun.handleOom(manager.lockfile.scratch.dependency_list_queue.writeItem(.{ .package_id = package.meta.id, .dependencies = package.dependencies }));
```

Then, update the two write sites in `src/install/PackageManager/PackageManagerEnqueue.zig` (lines ~697 and ~1047). At both sites, change:

```zig
                            try this.lockfile.scratch.dependency_list_queue.writeItem(result.package.dependencies);
```

to:

```zig
                            try this.lockfile.scratch.dependency_list_queue.writeItem(.{ .package_id = result.package.meta.id, .dependencies = result.package.dependencies });
```

- [ ] **Step 4: Update the flush reader in runTasks.zig**

At `src/install/PackageManager/runTasks.zig:1096-1112`, change:

```zig
fn doFlushDependencyQueue(this: *PackageManager) void {
    var lockfile = this.lockfile;
    var dependency_queue = &lockfile.scratch.dependency_list_queue;

    while (dependency_queue.readItem()) |dependencies_list| {
        var i: u32 = dependencies_list.off;
        const end = dependencies_list.off +| dependencies_list.len;
        while (i < end) : (i += 1) {
            const dependency = lockfile.buffers.dependencies.items[i];
            this.enqueueDependencyWithMain(
                i,
                &dependency,
                lockfile.buffers.resolutions.items[i],
                false,
            ) catch {};
        }
    }

    this.flushNetworkQueue();
}
```

to:

```zig
fn doFlushDependencyQueue(this: *PackageManager) void {
    var lockfile = this.lockfile;
    var dependency_queue = &lockfile.scratch.dependency_list_queue;

    while (dependency_queue.readItem()) |item| {
        var i: u32 = item.dependencies.off;
        const end = item.dependencies.off +| item.dependencies.len;
        while (i < end) : (i += 1) {
            const dependency = lockfile.buffers.dependencies.items[i];
            this.enqueueDependencyWithMain(
                i,
                &dependency,
                lockfile.buffers.resolutions.items[i],
                false,
                item.package_id,
            ) catch {};
        }
    }

    this.flushNetworkQueue();
}
```

- [ ] **Step 5: Commit call site updates**

```bash
git add src/install/PackageManager/PackageManagerResolution.zig src/install/PackageManager/install_with_manager.zig src/install/PackageManager/PackageManagerEnqueue.zig src/install/PackageManager/processDependencyList.zig src/install/PackageManager/runTasks.zig src/install/lockfile.zig
git commit -m "feat: update all enqueue call sites to pass parent_package_id"
```

---

### Task 5: Parse npm nested overrides in OverrideMap

**Files:**
- Modify: `src/install/lockfile/OverrideMap.zig:86-208` (parseCount, parseFromOverrides)

**What:** Extend `parseFromOverrides` to recognize nested object properties (beyond `"."`) as scoped overrides. Update `parseCount` accordingly.

- [ ] **Step 1: Update `parseCount` for nested override counting**

In `parseCount`, change the `.e_object` branch from:

```zig
                .e_object => {
                    if (entry.value.?.asProperty(".")) |dot| {
                        if (dot.expr.asString(lockfile.allocator)) |s| {
                            builder.count(s);
                        }
                    }
                },
```

to:

```zig
                .e_object => {
                    if (entry.value.?.asProperty(".")) |dot| {
                        if (dot.expr.asString(lockfile.allocator)) |s| {
                            builder.count(s);
                        }
                    }
                    for (entry.value.?.data.e_object.properties.slice()) |child_prop| {
                        const child_key = child_prop.key.?.asString(lockfile.allocator) orelse continue;
                        if (strings.eqlComptime(child_key, ".")) continue;
                        if (child_prop.value.?.data != .e_string) continue;
                        builder.count(child_key);
                        builder.count(child_prop.value.?.data.e_string.slice(lockfile.allocator));
                    }
                },
```

- [ ] **Step 2: Update `parseFromOverrides` to parse scoped children**

In `parseFromOverrides`, replace the `value: { ... }` block (the one starting at `const value = value: {`) with logic that handles both `"."` (global) and child properties (scoped):

Replace the block starting at `const value = value: {` through `continue;` at line ~184 with:

```zig
        const value = value: {
            const value_expr = prop.value.?;
            if (value_expr.data == .e_string) {
                break :value value_expr;
            } else if (value_expr.data == .e_object) {
                if (value_expr.asProperty(".")) |dot| {
                    if (dot.expr.data == .e_string) {
                        break :value dot.expr;
                    } else {
                        try log.addWarningFmt(source, value_expr.loc, lockfile.allocator, "Invalid override value for \"{s}\"", .{k});
                        continue;
                    }
                } else {
                    break :value null;
                }
            }
            try log.addWarningFmt(source, value_expr.loc, lockfile.allocator, "Invalid override value for \"{s}\"", .{k});
            continue;
        };

        // Handle global override (string value or { ".": "version" })
        if (value) |val| {
            const version_str = val.data.e_string.slice(lockfile.allocator);
            if (strings.hasPrefixComptime(version_str, "patch:")) {
                try log.addWarningFmt(source, key.loc, lockfile.allocator, "Bun currently does not support patched package \"overrides\"", .{});
            } else if (try parseOverrideValue(
                "override",
                lockfile,
                pm,
                root_package,
                source,
                val.loc,
                log,
                k,
                version_str,
                builder,
            )) |version| {
                this.global.putAssumeCapacity(name_hash, version);
            }
        }

        // Handle scoped override children in the object
        if (prop.value.?.data == .e_object) {
            for (prop.value.?.data.e_object.properties.slice()) |child_prop| {
                const child_key_str = child_prop.key.?.asString(lockfile.allocator) orelse continue;
                if (strings.eqlComptime(child_key_str, ".")) continue;
                if (child_prop.value.?.data != .e_string) {
                    try log.addWarningFmt(source, child_prop.value.?.loc, lockfile.allocator, "Bun currently does not support nested \"overrides\"", .{});
                    continue;
                }
                const child_version_str = child_prop.value.?.data.e_string.slice(lockfile.allocator);
                if (strings.hasPrefixComptime(child_version_str, "patch:")) {
                    try log.addWarningFmt(source, child_prop.key.?.loc, lockfile.allocator, "Bun currently does not support patched package \"overrides\"", .{});
                    continue;
                }
                if (try parseOverrideValue(
                    "override",
                    lockfile,
                    pm,
                    root_package,
                    source,
                    child_prop.value.?.loc,
                    log,
                    child_key_str,
                    child_version_str,
                    builder,
                )) |child_dep| {
                    const child_name_hash = String.Builder.stringHash(child_key_str);
                    this.scoped.putAssumeCapacity(.{ .parent_name_hash = name_hash, .child_name_hash = child_name_hash }, child_dep);
                }
            }
        }
```

**Note:** The `value` variable is now `?Expr` instead of `Expr`. Update the variable type annotation accordingly. The key insight is: if the object has `"."`, that's the global override for the key. All other string properties in the same object are scoped overrides where the key is the parent package name.

- [ ] **Step 3: Update the debug log line**

At the end of `parseAppend`, change:

```zig
    debug("parsed {d} overrides", .{this.map.entries.len});
```

to:

```zig
    debug("parsed {d} global + {d} scoped overrides", .{ this.global.entries.len, this.scoped.entries.len });
```

- [ ] **Step 4: Commit parsing changes**

```bash
git add src/install/lockfile/OverrideMap.zig
git commit -m "feat: parse npm nested overrides into scoped OverrideMap entries"
```

---

### Task 6: Parse Yarn nested resolutions in OverrideMap

**Files:**
- Modify: `src/install/lockfile/OverrideMap.zig:212-281` (parseFromResolutions)

**What:** Extend `parseFromResolutions` to parse `parent/child` and `@scope/parent/child` path keys as scoped overrides instead of rejecting them.

- [ ] **Step 1: Update `parseFromResolutions` to handle nested path keys**

Replace the key processing section in `parseFromResolutions` (the block that currently rejects slash-containing keys). Replace the block starting after `const value = prop.value.?;` through the `if (try parseOverrideValue(...))` block with:

```zig
        if (value.data != .e_string) {
            try log.addWarningFmt(source, key.loc, lockfile.allocator, "Expected string value for resolution \"{s}\"", .{k});
            continue;
        }

        const version_str = value.data.e_string.data;
        if (strings.hasPrefixComptime(version_str, "patch:")) {
            try log.addWarningFmt(source, key.loc, lockfile.allocator, "Bun currently does not support patched package \"resolutions\"", .{});
            continue;
        }

        // Parse parent/child from resolution key
        const parent_child = parentChild: {
            // Detect the last '/' that separates parent from child
            // For scoped packages like @scope/parent/child, the first '/' belongs
            // to the scope prefix; the second '/' separates parent from child.
            var last_slash: ?usize = null;
            if (k[0] == '@') {
                // @scope/parent/child — skip the scope's '/' and look for the next one
                const first_slash = strings.indexOfChar(k, '/') orelse {
                    break :parentChild null;
                };
                // Look for a second slash after the scope prefix
                if (strings.indexOfChar(k[first_slash + 1 ..], '/')) |second_rel| {
                    last_slash = first_slash + 1 + second_rel;
                }
            } else {
                last_slash = strings.lastIndexOfChar(k, '/');
            }

            break :parentChild if (last_slash) |sep| struct {
                parent: []const u8,
                child: []const u8,
            }{
                .parent = k[0..sep],
                .child = k[sep + 1 ..],
            } else null;
        };

        if (try parseOverrideValue(
            "resolution",
            lockfile,
            pm,
            root_package,
            source,
            value.loc,
            log,
            if (parent_child) |pc| pc.child else k,
            version_str,
            builder,
        )) |dep| {
            if (parent_child) |pc| {
                // Scoped resolution
                const parent_name_hash = String.Builder.stringHash(pc.parent);
                this.scoped.putAssumeCapacity(.{ .parent_name_hash = parent_name_hash, .child_name_hash = dep.name_hash }, dep);
            } else {
                // Global resolution
                const name_hash = String.Builder.stringHash(k);
                this.global.putAssumeCapacity(name_hash, dep);
            }
        }
```

**Note:** This replaces the existing code that rejects nested resolutions. The key difference is that `@scope/parent/child` is now parsed as `parent = "@scope/parent"`, `child = "child"`. And `parent/child` is parsed as `parent = "parent"`, `child = "child"`.

- [ ] **Step 2: Commit Yarn nested resolutions parsing**

```bash
git add src/install/lockfile/OverrideMap.zig
git commit -m "feat: parse Yarn nested resolutions into scoped OverrideMap entries"
```

---

### Task 7: Update OverrideMap sort, count, clone, deinit for the two-map structure

**Files:**
- Modify: `src/install/lockfile/OverrideMap.zig:24-69`

**What:** The `sort`, `count`, `clone`, and `deinit` functions must handle both `global` and `scoped` maps.

- [ ] **Step 1: Update `sort()`**

Replace the existing `sort()` with:

```zig
pub fn sort(this: *OverrideMap, lockfile: *const Lockfile) void {
    const Ctx = struct {
        buf: string,
        override_deps: [*]const Dependency,

        pub fn lessThan(sorter: *const @This(), l: usize, r: usize) bool {
            const deps = sorter.override_deps;
            const l_dep = deps[l];
            const r_dep = deps[r];

            const buf = sorter.buf;
            return l_dep.name.order(&r_dep.name, buf, buf) == .lt;
        }
    };

    const ctx: Ctx = .{
        .buf = lockfile.buffers.string_bytes.items,
        .override_deps = this.global.values().ptr,
    };

    this.global.sort(&ctx);

    const ScopedCtx = struct {
        buf: string,
        scoped_keys: [*]const ScopedOverrideKey,
        override_deps: [*]const Dependency,

        pub fn lessThan(sorter: *const @This(), l: usize, r: usize) bool {
            const keys = sorter.scoped_keys;
            const l_key = keys[l];
            const r_key = keys[r];
            if (l_key.parent_name_hash != r_key.parent_name_hash) {
                return l_key.parent_name_hash < r_key.parent_name_hash;
            }
            const deps = sorter.override_deps;
            return deps[l].name.order(&deps[r].name, sorter.buf, sorter.buf) == .lt;
        }
    };

    const scoped_ctx: ScopedCtx = .{
        .buf = lockfile.buffers.string_bytes.items,
        .scoped_keys = this.scoped.keys().ptr,
        .override_deps = this.scoped.values().ptr,
    };

    this.scoped.sort(&scoped_ctx);
}
```

- [ ] **Step 2: Update `deinit()`**

Replace with:

```zig
pub fn deinit(this: *OverrideMap, allocator: Allocator) void {
    this.global.deinit(allocator);
    this.scoped.deinit(allocator);
}
```

- [ ] **Step 3: Update `count()`**

Replace with:

```zig
pub fn count(this: *OverrideMap, lockfile: *Lockfile, builder: *Lockfile.StringBuilder) void {
    for (this.global.values()) |dep| {
        dep.count(lockfile.buffers.string_bytes.items, @TypeOf(builder), builder);
    }
    for (this.scoped.values()) |dep| {
        dep.count(lockfile.buffers.string_bytes.items, @TypeOf(builder), builder);
    }
    // Count the parent name strings stored in scoped keys — they need string bytes too
    for (this.scoped.keys()) |key| {
        // Parent name hash -> need to count the string for it in the builder
        // The parent name is already in the string pool, so no extra count is needed
        // unless we are adding a new string. For now, parent names come from the
        // existing package name pool, so no additional counting is needed.
        _ = key;
    }
}
```

- [ ] **Step 4: Update `clone()`**

Replace with:

```zig
pub fn clone(this: *OverrideMap, pm: *PackageManager, old_lockfile: *Lockfile, new_lockfile: *Lockfile, new_builder: *Lockfile.StringBuilder) !OverrideMap {
    var new = OverrideMap{};
    try new.global.ensureTotalCapacity(new_lockfile.allocator, this.global.entries.len);

    for (this.global.keys(), this.global.values()) |k, v| {
        new.global.putAssumeCapacity(
            k,
            try v.clone(pm, old_lockfile.buffers.string_bytes.items, @TypeOf(new_builder), new_builder),
        );
    }

    try new.scoped.ensureTotalCapacity(new_lockfile.allocator, this.scoped.entries.len);
    for (this.scoped.keys(), this.scoped.values()) |k, v| {
        new.scoped.putAssumeCapacity(
            k,
            try v.clone(pm, old_lockfile.buffers.string_bytes.items, @TypeOf(new_builder), new_builder),
        );
    }

    return new;
}
```

- [ ] **Step 5: Commit OverrideMap operation updates**

```bash
git add src/install/lockfile/OverrideMap.zig
git commit -m "feat: update OverrideMap sort/count/clone/deinit for two-map structure"
```

---

### Task 8: Update overrides_changed diff in Package.zig

**Files:**
- Modify: `src/install/lockfile/Package.zig:574-597`

**What:** The `overrides_changed` comparison must also compare scoped override entries.

- [ ] **Step 1: Update the overrides comparison in the Summary diff**

In `src/install/lockfile/Package.zig`, replace the block from line ~574 through ~597 with:

```zig
                const global_changed = changed: {
                    if (from_lockfile.overrides.global.count() != to_lockfile.overrides.global.count()) {
                        if (PackageManager.verbose_install) {
                            Output.prettyErrorln("Overrides changed since last install", .{});
                        }
                        break :changed true;
                    }

                    from_lockfile.overrides.sort(from_lockfile);
                    to_lockfile.overrides.sort(to_lockfile);
                    for (
                        from_lockfile.overrides.global.keys(),
                        from_lockfile.overrides.global.values(),
                        to_lockfile.overrides.global.keys(),
                        to_lockfile.overrides.global.values(),
                    ) |from_k, *from_override, to_k, *to_override| {
                        if ((from_k != to_k) or (!from_override.eql(to_override, from_lockfile.buffers.string_bytes.items, to_lockfile.buffers.string_bytes.items))) {
                            if (PackageManager.verbose_install) {
                                Output.prettyErrorln("Overrides changed since last install", .{});
                            }
                            break :changed true;
                        }
                    }
                    break :changed false;
                };

                const scoped_changed = changed: {
                    if (from_lockfile.overrides.scoped.count() != to_lockfile.overrides.scoped.count()) {
                        if (PackageManager.verbose_install) {
                            Output.prettyErrorln("Overrides changed since last install", .{});
                        }
                        break :changed true;
                    }

                    for (
                        from_lockfile.overrides.scoped.keys(),
                        from_lockfile.overrides.scoped.values(),
                        to_lockfile.overrides.scoped.keys(),
                        to_lockfile.overrides.scoped.values(),
                    ) |from_k, *from_override, to_k, *to_override| {
                        if ((from_k.parent_name_hash != to_k.parent_name_hash or from_k.child_name_hash != to_k.child_name_hash) or (!from_override.eql(to_override, from_lockfile.buffers.string_bytes.items, to_lockfile.buffers.string_bytes.items))) {
                            if (PackageManager.verbose_install) {
                                Output.prettyErrorln("Overrides changed since last install", .{});
                            }
                            break :changed true;
                        }
                    }
                    break :changed false;
                };

                if (global_changed or scoped_changed) {
                    summary.overrides_changed = true;
                }
```

- [ ] **Step 2: Commit diff logic update**

```bash
git add src/install/lockfile/Package.zig
git commit -m "feat: update overrides_changed diff to compare scoped overrides"
```

---

### Task 9: Update binary lockfile serialization for scoped overrides

**Files:**
- Modify: `src/install/lockfile/bun.lockb.zig:10,131-157` (write)
- Modify: `src/install/lockfile/bun.lockb.zig:446-475` (read)

**What:** Add a new tag for scoped overrides in the binary lockfile format, and read/write the `scoped` map alongside the `global` map.

- [ ] **Step 1: Add the scoped overrides tag and write logic**

At the top of `bun.lockb.zig`, after the `has_overrides_tag` declaration (~line 10), add:

```zig
const has_scoped_overrides_tag: u64 = @bitCast(@as([8]u8, "sCopedOs".*));
```

Then, after the existing overrides write block (after line ~157), add a new block:

```zig
    if (this.overrides.scoped.count() > 0) {
        try writer.writeAll(std.mem.asBytes(&has_scoped_overrides_tag));

        // Write scoped keys as two parallel arrays: parent_name_hashes and child_name_hashes
        var parent_name_hashes = try std.ArrayListUnmanaged(PackageNameHash).initCapacity(z_allocator, this.overrides.scoped.count());
        defer parent_name_hashes.deinit(z_allocator);
        var child_name_hashes = try std.ArrayListUnmanaged(PackageNameHash).initCapacity(z_allocator, this.overrides.scoped.count());
        defer child_name_hashes.deinit(z_allocator);
        parent_name_hashes.items.len = this.overrides.scoped.count();
        child_name_hashes.items.len = this.overrides.scoped.count();

        for (this.overrides.scoped.keys(), 0..) |key, i| {
            parent_name_hashes.items[i] = key.parent_name_hash;
            child_name_hashes.items[i] = key.child_name_hash;
        }

        try Lockfile.Buffers.writeArray(
            StreamType,
            stream,
            @TypeOf(writer),
            writer,
            []PackageNameHash,
            parent_name_hashes.items,
        );
        try Lockfile.Buffers.writeArray(
            StreamType,
            stream,
            @TypeOf(writer),
            writer,
            []PackageNameHash,
            child_name_hashes.items,
        );

        var external_scoped_overrides = try std.ArrayListUnmanaged(Dependency.External).initCapacity(z_allocator, this.overrides.scoped.count());
        defer external_scoped_overrides.deinit(z_allocator);
        external_scoped_overrides.items.len = this.overrides.scoped.count();
        for (external_scoped_overrides.items, this.overrides.scoped.values()) |*dest, src| {
            dest.* = src.toExternal();
        }

        try Lockfile.Buffers.writeArray(
            StreamType,
            stream,
            @TypeOf(writer),
            writer,
            []Dependency.External,
            external_scoped_overrides.items,
        );
    }
```

- [ ] **Step 2: Add the scoped overrides read logic**

After the existing overrides read block (after line ~475), add:

```zig
    {
        const remaining_in_buffer = total_buffer_size -| stream.pos;

        if (remaining_in_buffer > 8 and total_buffer_size <= stream.buffer.len) {
            const next_num = try reader.readInt(u64, .little);
            if (next_num == has_scoped_overrides_tag) {
                var parent_name_hashes = try Lockfile.Buffers.readArray(
                    stream,
                    allocator,
                    std.ArrayListUnmanaged(PackageNameHash),
                );
                defer parent_name_hashes.deinit(allocator);

                var child_name_hashes = try Lockfile.Buffers.readArray(
                    stream,
                    allocator,
                    std.ArrayListUnmanaged(PackageNameHash),
                );
                defer child_name_hashes.deinit(allocator);

                const scoped_versions_external = try Lockfile.Buffers.readArray(
                    stream,
                    allocator,
                    std.ArrayListUnmanaged(Dependency.External),
                );

                try lockfile.overrides.scoped.ensureTotalCapacity(allocator, parent_name_hashes.items.len);

                const context: Dependency.Context = .{
                    .allocator = allocator,
                    .log = log,
                    .buffer = lockfile.buffers.string_bytes.items,
                    .package_manager = manager,
                };
                for (parent_name_hashes.items, child_name_hashes.items, scoped_versions_external.items) |parent_hash, child_hash, value| {
                    lockfile.overrides.scoped.putAssumeCapacity(
                        .{ .parent_name_hash = parent_hash, .child_name_hash = child_hash },
                        Dependency.toDependency(value, context),
                    );
                }
            } else {
                stream.pos -= 8;
            }
        }
    }
```

- [ ] **Step 3: Commit binary lockfile serialization**

```bash
git add src/install/lockfile/bun.lockb.zig
git commit -m "feat: add scoped overrides to binary lockfile serialization"
```

---

### Task 10: Update text lockfile serialization for scoped overrides

**Files:**
- Modify: `src/install/lockfile/bun.lock.zig:303-321` (write)
- Modify: `src/install/lockfile/bun.lock.zig:1239-1287` (read)

**What:** Write scoped overrides as `"parent/child": "version"` in the text lockfile. Read them back by detecting the slash in the key.

- [ ] **Step 1: Update text lockfile writer**

In the overrides write section of `bun.lock.zig` (~line 303), change:

```zig
            if (lockfile.overrides.map.count() > 0) {
                lockfile.overrides.sort(lockfile);

                try writeIndent(writer, indent);
                try writer.writeAll(
                    \\"overrides": {
                    \\
                );
                indent.* += 1;
                for (lockfile.overrides.map.values()) |override_dep| {
                    try writeIndent(writer, indent);
                    try writer.print(
                        \\{f}: {f},
                        \\
                    , .{ override_dep.name.fmtJson(buf, .{}), override_dep.version.literal.fmtJson(buf, .{}) });
                }

                try decIndent(writer, indent);
                try writer.writeAll("},\n");
            }
```

to:

```zig
            if (lockfile.overrides.global.count() > 0 or lockfile.overrides.scoped.count() > 0) {
                lockfile.overrides.sort(lockfile);

                try writeIndent(writer, indent);
                try writer.writeAll(
                    \\"overrides": {
                    \\
                );
                indent.* += 1;
                for (lockfile.overrides.global.values()) |override_dep| {
                    try writeIndent(writer, indent);
                    try writer.print(
                        \\{f}: {f},
                        \\
                    , .{ override_dep.name.fmtJson(buf, .{}), override_dep.version.literal.fmtJson(buf, .{}) });
                }
                for (lockfile.overrides.scoped.keys(), lockfile.overrides.scoped.values()) |key, override_dep| {
                    try writeIndent(writer, indent);
                    // Look up the parent package name from its name hash
                    const parent_name = lockfile.packages.items(.name)[0]; // fallback — we need to resolve hash to name
                    // We need to find the string for the parent_name_hash. Search the string pool.
                    const parent_str = brk: {
                        // Search the overrides global map for a name matching this hash
                        // Or search package names
                        for (lockfile.overrides.global.values()) |dep| {
                            if (dep.name_hash == key.parent_name_hash) {
                                break :brk lockfile.str(&dep.name);
                            }
                        }
                        // Search all package names
                        for (lockfile.packages.items(.name_hash), 0..) |nh, i| {
                            if (nh == key.parent_name_hash) {
                                break :brk lockfile.str(&lockfile.packages.items(.name)[i]);
                            }
                        }
                        break :brk "<unknown>";
                    };
                    try writer.print(
                        \\{s}/{f}: {f},
                        \\
                    , .{ parent_str, override_dep.name.fmtJson(buf, .{}), override_dep.version.literal.fmtJson(buf, .{}) });
                }

                try decIndent(writer, indent);
                try writer.writeAll("},\n");
            }
```

- [ ] **Step 2: Update text lockfile reader**

In the overrides read section of `bun.lock.zig` (~line 1239), after reading a key, detect if it contains a slash to determine if it's a scoped override. Replace the key-processing block with logic that splits on the last slash (respecting scoped packages) and stores into the appropriate map.

Change the override reading section (starting at `if (root.get("overrides")) |overrides_expr| {`) to also handle scoped keys. After the existing `lockfile.overrides.map.put(allocator, name_hash, dep)` line, add handling for slash-containing keys:

```zig
            // Check if this is a scoped override (parent/child)
            const is_scoped = brk: {
                if (name_str[0] == '@') {
                    // @scope/parent/child — first slash is part of scope
                    const first_slash = strings.indexOfChar(name_str, '/') orelse break :brk false;
                    break :brk strings.indexOfChar(name_str[first_slash + 1 ..], '/') != null;
                } else {
                    break :brk strings.indexOfChar(name_str, '/') != null;
                }
            };

            if (is_scoped) {
                // Split on last slash to get parent and child
                const last_slash = strings.lastIndexOfChar(name_str, '/').?;
                const parent_str = name_str[0..last_slash];
                const child_str = name_str[last_slash + 1 ..];
                const parent_hash = String.Builder.stringHash(parent_str);
                const child_hash = String.Builder.stringHash(child_str);
                const child_name = try string_buf.appendWithHash(child_str, child_hash);
                // Re-parse as the child dependency
                const dep: Dependency = .{
                    .name = child_name,
                    .name_hash = child_hash,
                    .version = Dependency.parse(
                        allocator,
                        child_name,
                        child_hash,
                        version_sliced.slice,
                        &version_sliced,
                        log,
                        manager,
                    ) orelse {
                        try log.addError(source, value.loc, "Invalid override version");
                        return error.InvalidOverridesObject;
                    },
                };
                try lockfile.overrides.scoped.put(allocator, .{ .parent_name_hash = parent_hash, .child_name_hash = child_hash }, dep);
            } else {
                try lockfile.overrides.global.put(allocator, name_hash, dep);
            }
```

**Note:** This replaces the single `lockfile.overrides.map.put(allocator, name_hash, dep);` call at the end of the override reading loop.

- [ ] **Step 3: Also update the `overrides.map` references elsewhere in bun.lock.zig**

Search for any other references to `lockfile.overrides.map` in `bun.lock.zig` and update them to `lockfile.overrides.global`.

- [ ] **Step 4: Commit text lockfile serialization**

```bash
git add src/install/lockfile/bun.lock.zig
git commit -m "feat: add scoped overrides to text lockfile serialization"
```

---

### Task 11: Update remaining references to `overrides.map`

**Files:**
- Modify: `src/install/PackageManager/install_with_manager.zig:224,239,257,368`
- Modify: `src/install/lockfile.zig:683,686,1768`
- Modify: `src/install/lockfile/Package.zig:574,581-597` (already done in Task 8)

**What:** All remaining `overrides.map` references must be changed to `overrides.global`.

- [ ] **Step 1: Search and replace all `overrides.map` → `overrides.global`**

Search the entire `src/install/` directory for any remaining `.overrides.map` references and change them to `.overrides.global`.

Known locations:
- `install_with_manager.zig:224` — `lockfile.overrides.count(&lockfile, builder);` (this calls OverrideMap.count, which is already updated)
- `install_with_manager.zig:257` — `lockfile.overrides.clone(...)` (already updated)
- `lockfile.zig:683` — `old.overrides.count(old, &builder);` (already updated)
- `lockfile.zig:686` — `new.overrides = try old.overrides.clone(...)` (already updated)
- `lockfile.zig:1768` — `this.overrides.deinit(this.allocator);` (already updated)

These should work correctly because `count`, `clone`, and `deinit` have been updated. However, verify that no code accesses `.overrides.map` directly. Search for `overrides.map` across all `.zig` files.

- [ ] **Step 2: Commit the reference cleanup**

```bash
git add -u
git commit -m "chore: update remaining overrides.map references to overrides.global"
```

---

### Task 12: Write integration tests for nested overrides

**Files:**
- Modify: `test/cli/install/overrides.test.ts`

**What:** Add tests for npm nested overrides and Yarn nested resolutions scoped to a parent package.

- [ ] **Step 1: Add test for npm nested override scoped to parent**

Append to `test/cli/install/overrides.test.ts`:

```typescript
test("nested override applies only under matching parent", async () => {
  const tmp = tmpdirSync();
  writeFileSync(
    join(tmp, "package.json"),
    JSON.stringify({
      dependencies: {
        express: "4.18.2",
      },
      overrides: {
        express: {
          bytes: "1.0.0",
        },
      },
    }),
  );
  install(tmp, ["install"]);
  // bytes is a dependency of express, so the override should apply
  expect(versionOf(tmp, "node_modules/bytes/package.json")).toBe("1.0.0");
  ensureLockfileDoesntChangeOnBunI(tmp);
});

test("nested override does not apply under different parent", async () => {
  const tmp = tmpdirSync();
  writeFileSync(
    join(tmp, "package.json"),
    JSON.stringify({
      dependencies: {
        lodash: "4.17.21",
        express: "4.18.2",
      },
      overrides: {
        lodash: {
          bytes: "1.0.0",
        },
      },
    }),
  );
  install(tmp, ["install"]);
  // bytes is a dependency of express, NOT lodash — override should NOT apply
  const bytesVersion = versionOf(tmp, "node_modules/bytes/package.json");
  expect(bytesVersion).not.toBe("1.0.0");
});
```

- [ ] **Step 2: Add test for npm object with dot and child override**

```typescript
test("nested override with dot notation sets global and scoped", async () => {
  const tmp = tmpdirSync();
  writeFileSync(
    join(tmp, "package.json"),
    JSON.stringify({
      dependencies: {
        express: "4.18.2",
      },
      overrides: {
        express: {
          ".": "4.18.2",
          bytes: "1.0.0",
        },
      },
    }),
  );
  install(tmp, ["install"]);
  // bytes overridden under express
  expect(versionOf(tmp, "node_modules/bytes/package.json")).toBe("1.0.0");
  // express itself at the specified version
  expect(versionOf(tmp, "node_modules/express/package.json")).toBe("4.18.2");
  ensureLockfileDoesntChangeOnBunI(tmp);
});
```

- [ ] **Step 3: Add test for Yarn-style nested resolution**

```typescript
test("Yarn-style nested resolution applies only under matching parent", async () => {
  const tmp = tmpdirSync();
  writeFileSync(
    join(tmp, "package.json"),
    JSON.stringify({
      dependencies: {
        express: "4.18.2",
      },
      resolutions: {
        "express/bytes": "1.0.0",
      },
    }),
  );
  install(tmp, ["install"]);
  expect(versionOf(tmp, "node_modules/bytes/package.json")).toBe("1.0.0");
  ensureLockfileDoesntChangeOnBunI(tmp);
});
```

- [ ] **Step 4: Add test for scoped package nested resolution**

```typescript
test("Yarn-style nested resolution with scoped parent", async () => {
  const tmp = tmpdirSync();
  writeFileSync(
    join(tmp, "package.json"),
    JSON.stringify({
      dependencies: {
        "@babel/core": "7.23.0",
      },
      resolutions: {
        "@babel/core/semver": "7.5.4",
      },
    }),
  );
  install(tmp, ["install"]);
  // semver inside @babel/core should be overridden
  expect(versionOf(tmp, "node_modules/semver/package.json")).toBe("7.5.4");
  ensureLockfileDoesntChangeOnBunI(tmp);
});
```

- [ ] **Step 5: Verify the tests fail with the current build (no nested override support)**

Run: `bun bd test test/cli/install/overrides.test.ts -t "nested override"`
Expected: Tests should fail because the current code doesn't support nested overrides yet.

- [ ] **Step 6: After implementing all previous tasks, verify the tests pass**

Run: `bun bd test test/cli/install/overrides.test.ts`
Expected: All nested override tests pass.

- [ ] **Step 7: Commit the test additions**

```bash
git add test/cli/install/overrides.test.ts
git commit -m "test: add integration tests for nested overrides and resolutions"
```

---

### Task 13: Build and run full test suite

**Files:**
- None (verification only)

- [ ] **Step 1: Build the debug binary**

Run: `bun bd`
Expected: Successful compilation with no errors.

- [ ] **Step 2: Run the existing override tests to confirm no regressions**

Run: `bun bd test test/cli/install/overrides.test.ts`
Expected: All existing tests pass (the new nested tests should also pass now).

- [ ] **Step 3: Run a broader install test suite**

Run: `bun bd test test/cli/install/`
Expected: No regressions in any install tests.

- [ ] **Step 4: Manually verify nested overrides with a real project**

Create a temp project with nested overrides in `package.json`, run `bun install`, verify the scoped override takes effect only for the matching parent.

---

## Self-Review Checklist

**Spec coverage:** Each section of `openspec/changes/nested-resolutions/design.md` maps to:
- Data model → Task 1
- `get()` with parent → Task 2
- Parent context flow → Tasks 3, 4
- Parsing npm overrides → Task 5
- Parsing Yarn resolutions → Task 6
- Operations (sort/count/clone/deinit) → Task 7
- Diffing → Task 8
- Binary serialization → Task 9
- Text serialization → Task 10
- Reference cleanup → Task 11
- Testing → Task 12
- Verification → Task 13

**Placeholder scan:** No TBDs, no "implement later", no "add appropriate error handling". All steps have concrete code.

**Type consistency:**
- `ScopedOverrideKey` uses `PackageNameHash` for both fields, matching the existing `PackageNameHash = u64`
- `DependencyListWithOwner` uses `PackageID` (u32) and `DependencySlice`, matching existing types
- `get()` signature is consistent across definition and call sites
- `ScopedOverrideContext.hash()` returns u32 (matching ArrayHashMap expectations)

**Potential gaps:**
- The text lockfile writer needs to resolve a `parent_name_hash` back to a string. The current approach searches package names and global overrides, but there may be edge cases where the parent name is not found in either. A more robust approach would store the parent name string in the scoped override value, or use a separate lookup table. This is noted as a risk in the design spec.
- The `enqueueDependencyWithMainAndSuccessFn` is called from `doFlushDependencyQueue` which now gets `parent_package_id` from the queue item. But there might be other callers of `enqueueDependencyWithMainAndSuccessFn` that also need updating — these should be found by the compiler as compilation errors.
