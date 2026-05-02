type ImportMetaObject = Partial<ImportMeta>;

$getter;
export function main(this: ImportMetaObject) {
  if (!Bun.isMainThread) return false;
  const path = this.path;
  const main = Bun.main;
  if (path === main) return true;
  // Windows standalone binaries: `Bun.main` is the standalone virtual path
  // (`B:/~BUN/root/entry.ts`, forward slashes — matching the `requireMap`
  // key used by `require.main`/`process.mainModule`), while
  // `import.meta.path` goes through WebKit's `URL::fileSystemPath()` which
  // converts `/` to `\` on Windows. Treat the two separators as equivalent
  // here instead of changing `Bun.main` (which would miss the CJS
  // `requireMap` key). See #30084.
  if (
    process.platform !== "win32" ||
    typeof path !== "string" ||
    typeof main !== "string" ||
    path.length !== main.length
  ) {
    return false;
  }
  // Use private $charCodeAt so user code overriding String.prototype.charCodeAt
  // can't corrupt the compare (src/js/CLAUDE.md convention for builtins).
  for (let i = 0, len = main.length; i < len; i++) {
    const a = path.$charCodeAt(i);
    const b = main.$charCodeAt(i);
    if (a === b) continue;
    if ((a === 47 || a === 92) && (b === 47 || b === 92)) continue;
    return false;
  }
  return true;
}
