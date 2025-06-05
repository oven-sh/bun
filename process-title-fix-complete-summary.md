# Complete Summary: Node.js process.title Compatibility Fix

## Problem

The Node.js test `test-process-title.js` was failing because Bun's `process.title` behavior didn't match Node.js:

- In Node.js, when `process.title` hasn't been explicitly set, it returns the full executable path (same as `process.execPath`)
- In Bun, it was returning just `"bun"`

## Test Case That Was Failing

```js
const xs = "x".repeat(1024);
const proc = spawnSync(process.execPath, ["-p", "process.title", xs]);
strictEqual(proc.stdout.toString().trim(), process.execPath);
```

## Solution Implemented

### First Attempt (caused stack overflow in debug build)

Modified `getTitle` in `src/bun.js/node/node_process.zig` to use `bun.selfExePath()`:

```zig
const exec_path = bun.selfExePath() catch {
    title.* = ZigString.init("bun");
    return;
};
title.* = ZigString.init(exec_path);
```

### Final Solution (simpler, avoids recursion)

Used `bun.argv[0]` instead:

```zig
pub fn getTitle(_: *JSGlobalObject, title: *ZigString) callconv(.C) void {
    title_mutex.lock();
    defer title_mutex.unlock();
    const str = bun.CLI.Bun__Node__ProcessTitle;

    if (str) |s| {
        title.* = ZigString.init(s);
    } else {
        // When no title has been set, return the full executable path (like Node.js)
        // Use argv[0] which should contain the full path to the executable
        if (bun.argv.len > 0) {
            title.* = ZigString.init(bun.argv[0]);
        } else {
            title.* = ZigString.init("bun");
        }
    }
}
```

## Additional Fix

Also fixed an unrelated build error in `src/bun.js/bindings/webcore/HTTPHeaderMap.cpp`:

```diff
- return String();
+ return StringView();
```

## Testing Status

- Build is currently in progress (Zig compilation takes time for debug builds)
- Once built, the test should pass as `process.title` will return the full executable path when not explicitly set

## Expected Behavior After Fix

```js
// Parent process
process.title; // Returns full path like "/usr/local/bin/bun"

// Child process spawned with long arguments
spawnSync(process.execPath, ["-p", "process.title", "x".repeat(1024)]);
// stdout should contain the full executable path, not just "bun"
```

This fix ensures Bun matches Node.js behavior where `process.title` defaults to the full executable path rather than just the binary name.
