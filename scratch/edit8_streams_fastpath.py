# WriteStream $fastPath (internal, path is discarded): skip getValidatedPath —
# it path.resolve()s, which needs process.cwd() and throws if cwd was deleted.
import pathlib
f = pathlib.Path("/Users/ciro/code/bun/.claude/worktrees/wave-insp/src/js/internal/fs/streams.ts")
s = f.read_text()
old = '''  let { fd, autoClose, fs: customFs, start, flush } = options;
  if (fd == null) {
    this[kFs] = customFs || fs;
    this.fd = null;
    this.path = getValidatedPath(path);'''
new = '''  let { fd, autoClose, fs: customFs, start, flush } = options;
  if (fd == null) {
    this[kFs] = customFs || fs;
    this.fd = null;
    // Internal $fastPath callers (writableFromFileSink) discard .path; do not
    // resolve it - path.resolve("") needs process.cwd(), which throws when
    // the cwd has been deleted (Node still spawns children in that state).
    this.path = fastPath ? path : getValidatedPath(path);'''
assert s.count(old) == 1, "WriteStream ctor"
s = s.replace(old, new)
f.write_text(s)
print("edit8 OK")
