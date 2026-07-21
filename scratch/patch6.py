p = "/Users/ciro/code/bun/.claude/worktrees/wave-tls/src/js/node/net.ts"
src = open(p).read()
old = """Object.defineProperty(Socket.prototype, "bufferSize", {
  get: function () {
    return this.writableLength;
  },
});
"""
new = """Object.defineProperty(Socket.prototype, "bufferSize", {
  get: function () {
    // Node returns undefined once the handle is gone (after close).
    if (this._handle) {
      return this.writableLength;
    }
  },
});
"""
assert src.count(old) == 1, f"match count = {src.count(old)}"
open(p, "w").write(src.replace(old, new))
print("patched bufferSize getter")
