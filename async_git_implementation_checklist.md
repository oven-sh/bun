# Async Git Implementation Checklist

## Step 1: Add Git Completion Callbacks to PackageManager

Add these functions to `src/install/install.zig` after line 4785 (before `const CacheDir = struct`):

```zig
    // Git operation completion callbacks
    pub fn onGitDownloadComplete(
        this: *PackageManager,
        task_id: u64,
        result: anyerror!std.fs.Dir,
        ctx: anytype,
    ) void {
        const dependency_list_entry = this.task_queue.getEntry(task_id) orelse {
            // Task was cancelled or already processed
            if (result) |dir| dir.close() else |_| {}
            return;
        };
        const dependency_list = dependency_list_entry.value_ptr.*;
        dependency_list_entry.value_ptr.* = .{};

        if (result) |repo_dir| {
            this.git_repositories.put(this.allocator, task_id, .fromStdDir(repo_dir)) catch unreachable;
            
            // Now we need to find the commit
            Repository.findCommit(
                this,
                repo_dir,
                ctx.name,
                if (this.lockfile.buffers.dependencies.items.len > 0 and ctx.dep_id < this.lockfile.buffers.dependencies.items.len)
                    this.lockfile.str(&this.lockfile.buffers.dependencies.items[ctx.dep_id].version.value.git.committish)
                else
                    "",
                task_id,
            );
        } else |err| {
            if (PackageManager.verbose_install or this.options.log_level != .silent) {
                const name = ctx.name;
                if (err == error.RepositoryNotFound or ctx.attempt > 1) {
                    this.log.addErrorFmt(
                        null,
                        logger.Loc.Empty,
                        this.allocator,
                        "\"git clone\" for \"{s}\" failed",
                        .{name},
                    ) catch unreachable;
                } else {
                    this.log.addErrorFmt(
                        null,
                        logger.Loc.Empty,
                        this.allocator,
                        "{s} cloning repository for <b>{s}<r>",
                        .{
                            @errorName(err),
                            name,
                        },
                    ) catch unreachable;
                }
            }
            // Process the dependency list even on error to prevent hanging
            this.processDependencyList(dependency_list, void, {}, {}, false) catch {};
        }
    }

    pub fn onGitFindCommitComplete(
        this: *PackageManager,
        task_id: u64,
        result: anyerror!string,
        ctx: anytype,
    ) void {
        if (result) |resolved| {
            const checkout_id = Task.Id.forGitCheckout(
                this.lockfile.str(&this.lockfile.buffers.dependencies.items[ctx.dep_id].version.value.git.repo),
                resolved,
            );

            if (this.hasCreatedNetworkTask(
                checkout_id,
                this.lockfile.buffers.dependencies.items[ctx.dep_id].behavior.isRequired(),
            )) return;

            // Now checkout the specific commit
            Repository.checkout(
                this,
                this.getCacheDirectory(),
                ctx.repo_dir,
                ctx.name,
                this.lockfile.str(&this.lockfile.buffers.dependencies.items[ctx.dep_id].version.value.git.repo),
                resolved,
            );
        } else |err| {
            if (PackageManager.verbose_install or this.options.log_level != .silent) {
                this.log.addErrorFmt(
                    null,
                    logger.Loc.Empty,
                    this.allocator,
                    "no commit matching \"{s}\" found for \"{s}\" (but repository exists)",
                    .{ ctx.committish, ctx.name },
                ) catch unreachable;
            }
            
            // Process any pending dependency list
            if (this.task_queue.getEntry(task_id)) |entry| {
                const dependency_list = entry.value_ptr.*;
                entry.value_ptr.* = .{};
                this.processDependencyList(dependency_list, void, {}, {}, false) catch {};
            }
        }
    }

    pub fn onGitCheckoutComplete(
        this: *PackageManager,
        _: u64, // checkout doesn't use task_id
        result: anyerror!ExtractData,
        ctx: anytype,
    ) void {
        if (result) |data| {
            var package_id: PackageID = invalid_package_id;
            const dep_id = if (@hasField(@TypeOf(ctx), "dependency_id")) 
                ctx.dependency_id 
            else if (this.lockfile.buffers.dependencies.items.len > 0)
                @as(DependencyID, @intCast(0)) // fallback, should not happen
            else
                @as(DependencyID, @intCast(0));
                
            const resolution = Resolution{
                .tag = .git,
                .value = .{
                    .git = .{
                        .repo = this.lockfile.buffers.dependencies.items[dep_id].version.value.git.repo,
                        .committish = this.lockfile.buffers.dependencies.items[dep_id].version.value.git.committish,
                        .resolved = strings.StringOrTinyString.init(data.resolved).value,
                        .package_name = .{},
                    },
                },
            };
            
            if (this.processExtractedTarballPackage(
                &package_id,
                dep_id,
                &resolution,
                &data,
                this.options.log_level,
            )) |pkg| {
                // Update the dependency with the resolved name and commit
                var git = &this.lockfile.buffers.dependencies.items[dep_id].version.value.git;
                git.resolved = pkg.resolution.value.git.resolved;
                git.package_name = pkg.name;
                
                // Process the dependency now that we have the resolved info
                var any_root = false;
                this.processDependencyListItem(.{ .dependency = dep_id }, &any_root, false) catch {};
            }
        } else |err| {
            if (PackageManager.verbose_install or this.options.log_level != .silent) {
                this.log.addErrorFmt(
                    null,
                    logger.Loc.Empty,
                    this.allocator,
                    "\"git checkout\" for \"{s}\" failed: {s}",
                    .{ ctx.name, @errorName(err) },
                ) catch unreachable;
            }
        }
    }
```

## Step 2: Replace Git Operation Calls

In `src/install/install.zig`, around line 4056, replace:

```zig
this.task_batch.push(ThreadPool.Batch.from(this.enqueueGitClone(clone_id, alias, dep, id, dependency, &res, null)));
```

With:

```zig
// Store dependency context in task queue for later processing
var entry = this.task_queue.getOrPutContext(this.allocator, clone_id, .{}) catch unreachable;
if (!entry.found_existing) entry.value_ptr.* = .{};
try entry.value_ptr.append(this.allocator, ctx);

// Start async download - context includes dep_id for later use
Repository.download(this, this.getCacheDirectory(), clone_id, alias, this.lockfile.str(&dep.repo), 0, id);
```

And for an existing repository (around line 4033), we need to handle the case where we already have the repository:

```zig
// Instead of enqueueGitCheckout, directly call checkout
Repository.checkout(this, this.getCacheDirectory(), .fromStdDir(this.git_repositories.get(clone_id).?.stdDir()), alias, this.lockfile.str(&res.value.git.repo), resolved);
```

Note: The completion callbacks will need to be updated to include `dep_id` in their context structs:

```zig
// In the download completion context
Repository.download(this, this.getCacheDirectory(), clone_id, alias, this.lockfile.str(&dep.repo), 0, id);
// The last parameter 'id' is the dep_id that will be passed in the context
```

## Step 3: Remove Git-Related ThreadPool Code

### Remove from Task enum (around line 917):
```zig
git_clone = 2,
git_checkout = 3,
```

### Remove from Task.Data union (around line 931):
```zig
git_clone: bun.FileDescriptor,
git_checkout: ExtractData,
```

### Remove from Task.Request union (around line 945):
```zig
git_clone: struct {
    name: strings.StringOrTinyString,
    url: strings.StringOrTinyString,
    env: DotEnv.Map,
    dep_id: DependencyID,
    res: Resolution,
},
git_checkout: struct {
    repo_dir: bun.FileDescriptor,
    dependency_id: DependencyID,
    name: strings.StringOrTinyString,
    url: strings.StringOrTinyString,
    resolved: strings.StringOrTinyString,
    resolution: Resolution,
    env: DotEnv.Map,
},
```

### Remove from Task.run() switch (around lines 775-848):
Remove the entire `.git_clone => { ... }` and `.git_checkout => { ... }` cases.

### Remove functions (around lines 3414-3510):
- `enqueueGitClone()` 
- `enqueueGitCheckout()`

### Remove from runTasks() processing:
Remove the git_clone and git_checkout processing from the resolve_tasks switch statement.

## Step 4: Clean up repository.zig

Remove the synchronous `exec()` function and rename:
- `downloadSync` back to `downloadLegacy` (or remove if unused)
- `findCommitSync` back to `findCommitLegacy` (or remove if unused)  
- `checkoutSync` back to `checkoutLegacy` (or remove if unused)

## Step 5: Update any remaining references

Search for and update any remaining references to:
- `Repository.downloadSync`
- `Repository.findCommitSync`
- `Repository.checkoutSync`
- `Task.Tag.git_clone`
- `Task.Tag.git_checkout`

## Testing

After implementation:
1. Run `bun install` with a project containing git dependencies
2. Test various git URL formats:
   - `"github:user/repo"`
   - `"git+ssh://git@github.com:user/repo.git"`
   - `"git+https://github.com/user/repo.git"`
   - `"git://github.com/user/repo.git#commit"`
3. Verify error handling for:
   - Non-existent repositories
   - Invalid commits/tags
   - Network failures
4. Check that progress reporting still works correctly
5. Ensure lifecycle scripts in git dependencies are executed