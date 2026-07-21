import sys
p = "/Users/ciro/code/bun/.claude/worktrees/wave-tls/src/uws/lib.rs"
src = open(p).read()
old = """            }
            ret == 1 // truly closed
        }
"""
new = """            }
            // SSL_shutdown only queues close_notify into the write BIO; nothing
            // else pumps it on the memory-BIO paths (duplex / named pipe), so
            // drain it now or the peer never sees our shutdown.
            let mut buffer = [0u8; BUFFER_SIZE];
            Self::r(this).handle_writing(&mut buffer);
            ret == 1 // truly closed
        }
"""
assert src.count(old) == 1, f"match count = {src.count(old)}"
open(p, "w").write(src.replace(old, new))
print("patched lib.rs shutdown flush")
