p = "/Users/ciro/code/bun/.claude/worktrees/wave-tls/src/uws/lib.rs"
src = open(p).read()
old = """                        // flush the reading
                        if read > 0 {
                            log!("triggering data callback (read {})", read);
                            Self::r(this).trigger_data_callback(&buffer[0..read]);
                            // The data callback may have closed the connection
                            if Self::r(this).ssl.is_none() || Self::r(this).flags.closed_notified()
                            {
                                return false;
                            }
                        }
                        Self::r(this).trigger_close_callback();
                        return false;
"""
new = """                        // flush the reading
                        if read > 0 {
                            log!("triggering data callback (read {})", read);
                            Self::r(this).trigger_data_callback(&buffer[0..read]);
                            // The data callback may have closed the connection
                            if Self::r(this).ssl.is_none() || Self::r(this).flags.closed_notified()
                            {
                                return false;
                            }
                        }
                        // A NewSessionTicket/keylog line that rode in ahead of the
                        // peer's close_notify is still parked; deliver it before the
                        // close tears the wrapper down (mirrors the C ZERO_RETURN path).
                        Self::flush_pending_events(this, buffer);
                        if Self::r(this).ssl.is_none() || Self::r(this).flags.closed_notified() {
                            return false;
                        }
                        Self::r(this).trigger_close_callback();
                        return false;
"""
assert src.count(old) == 1, "hunk"
open(p, "w").write(src.replace(old, new))
print("patch11 applied")
