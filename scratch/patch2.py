p = "/Users/ciro/code/bun/.claude/worktrees/wave-tls/src/runtime/socket/UpgradedDuplex.rs"
src = open(p).read()
old = """        let name = if msg_more { "write" } else { "end" };
"""
new = """        if data.is_none() {
            // The duplex's write side can already be ended (TLS-inception
            // teardown ends the outer stream first); a second end() surfaces
            // a spurious EPIPE. writableEnded is node's flag for that state.
            if let Ok(Some(ended)) = duplex.get(&global, "writableEnded") {
                if ended.to_boolean() {
                    return;
                }
            }
        }

        let name = if msg_more { "write" } else { "end" };
"""
assert src.count(old) == 1, f"match count = {src.count(old)}"
open(p, "w").write(src.replace(old, new))
print("patched UpgradedDuplex writableEnded guard")
