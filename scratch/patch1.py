import io, sys
p = "src/runtime/server/server_body.rs"
s = open(p).read()
old = """        if sec_websocket_key_str.len != 24 {
            return Ok(JSValue::FALSE);
        }
"""
new = """        if sec_websocket_key_str.len != 24 {
            // Bun's own WebSocket server enforces the RFC 6455 key shape (16
            // random bytes, base64 = 24 chars), matching `ws`. Node's inspector
            // does not validate the key at all -- it echoes back
            // base64(sha1(key + GUID)) for whatever it was sent -- and clients
            // that talk to it (including Node's own test suite, which sends the
            // literal `key==`) rely on that. `internalAllowAnySecWebSocketKey`
            // is the opt-in used by the inspector server in
            // `src/js/internal/debugger.ts`; it is deliberately not a
            // documented `server.upgrade()` option. The key must still be
            // present, since the accept header is computed from it.
            let allow_any_key = match optional {
                Some(opts) if opts.is_object() => opts
                    .get_own_truthy(global, "internalAllowAnySecWebSocketKey")?
                    .is_some_and(JSValue::to_boolean),
                _ => false,
            };
            if !allow_any_key || sec_websocket_key_str.len == 0 {
                return Ok(JSValue::FALSE);
            }
        }
"""
assert s.count(old) == 1, s.count(old)
open(p, "w").write(s.replace(old, new))
print("patched", p)
