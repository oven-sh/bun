# Fix for Bun Install PathAlreadyExists Error with Workspaces

## Problem

When running `bun install` on a monorepo with workspaces (like the putout repository), Bun was throwing PathAlreadyExists errors when trying to link workspace dependencies. This happened because on non-Windows systems, the code didn't handle the case where symlinks already existed in the `node_modules` directory.

## Root Cause

In `src/install/install.zig`, the `installFromLink` function handles symlink creation differently for Windows and non-Windows systems:

1. **Windows** (working correctly): When creating a symlink fails with EXIST error, it removes the existing symlink and retries.
2. **Non-Windows** (had the bug): It didn't handle the PathAlreadyExists error, causing the installation to fail.

## Solution

The fix adds the same error handling logic to the non-Windows code path:

```zig
std.posix.symlinkat(target, dest_dir.fd, dest) catch |err| {
    if (err == error.PathAlreadyExists) {
        // Try to remove the existing symlink and retry
        std.posix.unlinkat(dest_dir.fd, dest, 0) catch {};
        std.posix.symlinkat(target, dest_dir.fd, dest) catch |retry_err| {
            return Result.fail(retry_err, .linking_dependency, null);
        };
    } else {
        return Result.fail(err, .linking_dependency, null);
    }
};
```

## How It Works

1. When creating a symlink for a workspace package, if it encounters `PathAlreadyExists` error
2. It attempts to remove the existing symlink using `unlinkat`
3. Then retries creating the symlink
4. If the retry fails, it returns the error from the retry attempt

This matches the behavior on Windows and ensures that running `bun install` multiple times on workspace projects won't fail with PathAlreadyExists errors.

## Testing

To test this fix:

1. Build Bun with the changes
2. Clone a repository with workspaces (e.g., https://github.com/coderaiser/putout)
3. Run `bun install` - it should work
4. Run `bun install` again - it should work without PathAlreadyExists errors

The fix ensures that workspace symlinks are properly updated even if they already exist in node_modules.
