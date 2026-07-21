import re
p = "/Users/ciro/code/bun/.claude/worktrees/wave-tls/src/runtime/socket/UpgradedDuplex.rs"
src = open(p).read()
old = """        // The duplex's write side can already be ended (TLS-inception teardown
        // ends the outer stream first); a write or second end() there only
        // surfaces a spurious EPIPE, so drop undeliverable shutdown bytes.
        if let Ok(Some(ended)) = duplex.get(&global, "writableEnded") {
            if ended.to_boolean() {
                return;
            }
        }
"""
new = """        // Teardown-phase bytes (close_notify / the trailing end()) aimed at a
        // duplex whose write side already ended (TLS-inception teardown) only
        // surface a spurious EPIPE - drop them. Ordinary data writes skip the
        // probe so write-after-end still errors like node.
        let teardown = data.is_none() || self.wrapper.as_ref().is_some_and(SslWrapperExt::is_shutdown);
        if teardown {
            match duplex.get(&global, "writableEnded") {
                Ok(Some(ended)) if ended.to_boolean() => return,
                Ok(_) => {}
                // Best-effort probe: consume the exception and fall through.
                Err(err) => drop(global.take_exception(err)),
            }
        }
"""
assert src.count(old) == 1, "guard hunk"
src = src.replace(old, new)
open(p, "w").write(src)
print("patch10a applied (needs is_shutdown accessor check)")

p2 = "/Users/ciro/code/bun/.claude/worktrees/wave-tls/src/uws/lib.rs"
src2 = open(p2).read()
old2 = """                        Self::r(this).flags.set_fatal_error(
                            err == boring_sys::SSL_ERROR_SSL
                                || err == boring_sys::SSL_ERROR_SYSCALL,
                        );

                        // flush the reading
"""
new2 = """                        if err == boring_sys::SSL_ERROR_SSL || err == boring_sys::SSL_ERROR_SYSCALL {
                            Self::r(this).flags.set_fatal_error(true);
                        }

                        // flush the reading
"""
assert src2.count(old2) == 1, "fatal hunk"
src2 = src2.replace(old2, new2)
open(p2, "w").write(src2)
print("patch10b applied")
