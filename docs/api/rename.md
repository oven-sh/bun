# Bun.rename()

Atomically rename a file or directory. This is similar to Node.js's `fs.promises.rename()`, but with an additional optional `conflict` parameter to control what happens when the destination already exists.

```ts
function rename(
  from: PathLike,
  to: PathLike,
  conflict?: "replace" | "swap" | "no-replace"
): Promise<void>;
```

## Parameters

- **from** - The current file or directory path (string, Buffer, or URL)
- **to** - The new file or directory path (string, Buffer, or URL)  
- **conflict** - How to handle conflicts when destination exists:
  - `"replace"` (default) - Replace the destination if it exists
  - `"swap"` - Atomically swap the files (Linux/macOS only, falls back to replace on Windows)
  - `"no-replace"` - Fail if destination already exists

## Basic Usage

```ts
// Simple rename - replaces destination if it exists
await Bun.rename("old-file.txt", "new-file.txt");

// Rename a directory
await Bun.rename("old-directory", "new-directory");

// Use Buffer paths
await Bun.rename(Buffer.from("old.txt"), Buffer.from("new.txt"));
```

## Conflict Resolution

### Replace Mode (Default)

By default, `Bun.rename()` will replace the destination if it exists:

```ts
import fs from "fs/promises";

// Create source and destination files
await Bun.write("source.txt", "Source content");
await Bun.write("dest.txt", "Original destination content");

// This will replace dest.txt with source.txt
await Bun.rename("source.txt", "dest.txt");

console.log(await Bun.file("dest.txt").text()); // "Source content"
// source.txt no longer exists
```

### No-Replace Mode

Prevent overwriting existing files:

```ts
// Create files
await Bun.write("source.txt", "Source content");
await Bun.write("dest.txt", "Destination content");

try {
  // This will throw an error because dest.txt exists
  await Bun.rename("source.txt", "dest.txt", "no-replace");
} catch (error) {
  console.log("Error:", error.message); // File already exists
}

// Both files still exist with their original content
```

### Swap Mode (Linux/macOS only)

Atomically swap two files or directories:

```ts
// Create two files
await Bun.write("file1.txt", "Content of file 1");
await Bun.write("file2.txt", "Content of file 2");

// Atomically swap the files
await Bun.rename("file1.txt", "file2.txt", "swap");

// The files have been swapped
console.log(await Bun.file("file1.txt").text()); // "Content of file 2"
console.log(await Bun.file("file2.txt").text()); // "Content of file 1"
```

#### Directory Swapping

```ts
// Create two directories with different content
await fs.mkdir("dir1");
await fs.mkdir("dir2");
await Bun.write("dir1/file.txt", "Content from dir1");
await Bun.write("dir2/file.txt", "Content from dir2");

// Atomically swap the directories
await Bun.rename("dir1", "dir2", "swap");

// The directories have been swapped
console.log(await Bun.file("dir1/file.txt").text()); // "Content from dir2"
console.log(await Bun.file("dir2/file.txt").text()); // "Content from dir1"
```

## Platform Differences

### Windows Limitations

On Windows, some conflict resolution modes have limitations due to platform constraints:

- **`"swap"`** - Falls back to `"replace"` behavior (atomic swap is not supported on Windows)
- **`"no-replace"`** - May not be fully atomic (checks existence then renames, creating a small race condition window)

```ts
// On Windows, this behaves like "replace"
await Bun.rename("file1.txt", "file2.txt", "swap");
```

### Unix/Linux/macOS

On Unix-like systems, all conflict modes are fully supported with atomic operations.

## Advanced Examples

### Safe File Updates

Use `"no-replace"` to safely create new files without overwriting:

```ts
async function safeWrite(filename: string, content: string) {
  const tempFile = `${filename}.tmp`;
  
  // Write to temporary file
  await Bun.write(tempFile, content);
  
  try {
    // Atomically rename if target doesn't exist
    await Bun.rename(tempFile, filename, "no-replace");
    console.log(`Created ${filename}`);
  } catch (error) {
    // Clean up temp file if target already exists
    await fs.unlink(tempFile);
    throw new Error(`File ${filename} already exists`);
  }
}
```

### Atomic File Replacement

Use the default mode for atomic file updates:

```ts
async function atomicUpdate(filename: string, updater: (content: string) => string) {
  // Read current content
  const currentContent = await Bun.file(filename).text();
  
  // Create updated content in temp file
  const tempFile = `${filename}.tmp.${Date.now()}`;
  await Bun.write(tempFile, updater(currentContent));
  
  // Atomically replace original file
  await Bun.rename(tempFile, filename); // Uses "replace" by default
}

await atomicUpdate("config.json", content => {
  const config = JSON.parse(content);
  config.version = "2.0.0";
  return JSON.stringify(config, null, 2);
});
```

### Log Rotation with Swap

Use `"swap"` to implement log rotation:

```ts
async function rotateLog(currentLog: string, archiveLog: string) {
  try {
    // If both files exist, swap them
    await Bun.rename(currentLog, archiveLog, "swap");
  } catch {
    // If archive doesn't exist, just rename current to archive
    await Bun.rename(currentLog, archiveLog);
  }
  
  // Create new empty log file
  await Bun.write(currentLog, "");
}

await rotateLog("app.log", "app.log.old");
```

## Error Handling

`Bun.rename()` throws errors for various conditions:

```ts
try {
  await Bun.rename("nonexistent.txt", "destination.txt");
} catch (error) {
  if (error.code === "ENOENT") {
    console.log("Source file doesn't exist");
  }
}

try {
  await Bun.rename("source.txt", "dest.txt", "no-replace");
} catch (error) {
  if (error.code === "EEXIST") {
    console.log("Destination file already exists");
  }
}
```

## Performance

`Bun.rename()` is implemented using the most efficient system calls available:

- **Linux**: Uses `renameat2()` with appropriate flags for atomic operations
- **macOS**: Uses `renameatx_np()` for extended rename operations
- **Windows**: Uses `MoveFileEx()` with atomic replacement when possible

The operation is typically very fast since it only updates directory entries rather than copying file data.

## Comparison with Node.js

| Feature | Node.js `fs.rename()` | `Bun.rename()` |
|---------|----------------------|----------------|
| Basic rename | ✅ | ✅ |
| Atomic replacement | ✅ (on Unix) | ✅ |
| Conflict resolution | ❌ | ✅ |
| Atomic swap | ❌ | ✅ (Unix only) |
| No-overwrite mode | ❌ | ✅ |
| Cross-filesystem moves | Falls back to copy | Falls back automatically |

```ts
// Node.js way
import { rename } from "fs/promises";
await rename("old.txt", "new.txt");

// Bun way with more control
await Bun.rename("old.txt", "new.txt", "no-replace");
```