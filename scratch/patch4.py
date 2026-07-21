p = "/Users/ciro/code/bun/.claude/worktrees/wave-tls/src/runtime/socket/UpgradedDuplex.rs"
src = open(p).read()
old = """        if data.is_none() {
            // The duplex's write side can already be ended (TLS-inception
            // teardown ends the outer stream first); a second end() surfaces
            // a spurious EPIPE. writableEnded is node's flag for that state.
            if let Ok(Some(ended)) = duplex.get(&global, "writableEnded") {
                if ended.to_boolean() {
                    return;
                }
            }
        }

"""
new = """        // The duplex's write side can already be ended (TLS-inception teardown
        // ends the outer stream first); a write or second end() there only
        // surfaces a spurious EPIPE, so drop undeliverable shutdown bytes.
        if let Ok(Some(ended)) = duplex.get(&global, "writableEnded") {
            if ended.to_boolean() {
                return;
            }
        }

"""
assert src.count(old) == 1, f"match count = {src.count(old)}"
open(p, "w").write(src.replace(old, new))
print("widened writableEnded guard to write+end")
