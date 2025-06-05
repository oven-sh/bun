# Fix for Node.js process.title compatibility

## Problem

The Node.js test `test-process-title.js` was failing because:

- When a child process is spawned in Bun, `process.title` was returning just `"bun"`
- In Node.js, when no title has been explicitly set, `process.title` returns the full executable path (same as `process.execPath`)

## Test case

```js
const xs = "x".repeat(1024);
const proc = spawnSync(process.execPath, ["-p", "process.title", xs]);
strictEqual(proc.stdout.toString().trim(), process.execPath);
```

## Solution

Modified `getTitle` function in `src/bun.js/node/node_process.zig`:

```diff
pub fn getTitle(_: *JSGlobalObject, title: *ZigString) callconv(.C) void {
    title_mutex.lock();
    defer title_mutex.unlock();
    const str = bun.CLI.Bun__Node__ProcessTitle;
-    title.* = ZigString.init(str orelse "bun");
+
+    if (str) |s| {
+        title.* = ZigString.init(s);
+    } else {
+        // When no title has been set, return the full executable path (like Node.js)
+        const exec_path = bun.selfExePath() catch {
+            // If we can't get the exec path, fallback to "bun"
+            title.* = ZigString.init("bun");
+            return;
+        };
+        title.* = ZigString.init(exec_path);
+    }
}
```

This ensures that when `process.title` hasn't been explicitly set (via `--title` flag or programmatically), it returns the full executable path, matching Node.js behavior.

## Additional fix

Also fixed an unrelated build error in `src/bun.js/bindings/webcore/HTTPHeaderMap.cpp` where a function was returning the address of a temporary object.
