def edit(path, pairs):
    s = open(path).read()
    for old, new, n in pairs:
        assert s.count(old) == n, (path, s.count(old), old[:70])
        s = s.replace(old, new)
    open(path, "w").write(s)
    print("patched", path)

# --- 1. uWS: per-behavior opt-out of the RFC 6455 key-shape routing gate
edit("packages/bun-uws/src/App.h", [(
"""        /* Maximum socket lifetime in minutes before forced closure (defaults to disabled) */
        unsigned short maxLifetime = 0;
        MoveOnlyFunction<void(HttpResponse<SSL> *, HttpRequest *, WebSocketContext<SSL, true, UserData> *)> upgrade = nullptr;""",
"""        /* Maximum socket lifetime in minutes before forced closure (defaults to disabled) */
        unsigned short maxLifetime = 0;
        /* Route upgrade requests whose Sec-WebSocket-Key is present but not the
         * RFC 6455 shape (16 random bytes, base64 = 24 chars) to the upgrade
         * handler anyway, leaving the decision to it. Only meaningful together
         * with a custom `upgrade` handler. Node's inspector protocol does not
         * validate the key, so a Node-compatible inspector endpoint has to
         * accept keys this check would otherwise route to the HTTP handler. */
        bool allowAnySecWebSocketKey = false;
        MoveOnlyFunction<void(HttpResponse<SSL> *, HttpRequest *, WebSocketContext<SSL, true, UserData> *)> upgrade = nullptr;""",
1), (
"""            std::string_view secWebSocketKey = req->getHeader("sec-websocket-key");
            if (secWebSocketKey.length() == 24) {""",
"""            std::string_view secWebSocketKey = req->getHeader("sec-websocket-key");
            if (secWebSocketKey.length() == 24 || (behavior.allowAnySecWebSocketKey && behavior.upgrade && secWebSocketKey.length())) {""",
1)])

# --- 2. C API struct
edit("src/uws_sys/_libusockets.h", [(
"""    unsigned short maxLifetime;

    uws_websocket_upgrade_handler upgrade;""",
"""    unsigned short maxLifetime;
    /* See uWS::WebSocketBehavior::allowAnySecWebSocketKey. */
    bool allowAnySecWebSocketKey;

    uws_websocket_upgrade_handler upgrade;""",
1)])

# --- 3. C shim (both SSL and non-SSL)
edit("src/uws_sys/libuwsockets.cpp", [(
"""          .maxLifetime = behavior.maxLifetime,
      };""",
"""          .maxLifetime = behavior.maxLifetime,
          .allowAnySecWebSocketKey = behavior.allowAnySecWebSocketKey,
      };""",
2)])

# --- 4. Rust mirror of the C struct
edit("src/uws_sys/WebSocket.rs", [(
"""    pub max_lifetime: c_ushort,
    pub upgrade: uws_websocket_upgrade_handler,""",
"""    pub max_lifetime: c_ushort,
    pub allow_any_sec_websocket_key: bool,
    pub upgrade: uws_websocket_upgrade_handler,""",
1), (
"""            max_lifetime: 0,
            upgrade: None,""",
"""            max_lifetime: 0,
            allow_any_sec_websocket_key: false,
            upgrade: None,""",
1), (
"""            max_lifetime: behavior.max_lifetime,
            upgrade: Some(Self::on_upgrade),""",
"""            max_lifetime: behavior.max_lifetime,
            allow_any_sec_websocket_key: behavior.allow_any_sec_websocket_key,
            upgrade: Some(Self::on_upgrade),""",
1)])

# --- 5. Bun.serve websocket config
edit("src/runtime/server/WebSocketServerContext.rs", [(
"""    pub close_on_backpressure_limit: bool,
}""",
"""    pub close_on_backpressure_limit: bool,
    /// Internal, undocumented: accept a `Sec-WebSocket-Key` of any non-zero
    /// length on this server. Bun's WebSocket server otherwise enforces the
    /// RFC 6455 shape, matching `ws`; Node's inspector does not validate the
    /// key at all, so the inspector server in `src/js/internal/debugger.ts`
    /// opts out of the check for itself. Not part of the public
    /// `Bun.serve({ websocket })` API.
    pub allow_any_sec_websocket_key: bool,
}""",
1), (
"""            close_on_backpressure_limit: self.close_on_backpressure_limit,
            ..Default::default()""",
"""            close_on_backpressure_limit: self.close_on_backpressure_limit,
            allow_any_sec_websocket_key: self.allow_any_sec_websocket_key,
            ..Default::default()""",
1), (
"""        close_on_backpressure_limit: false,
    };""",
"""        close_on_backpressure_limit: false,
        allow_any_sec_websocket_key: object
            .get(global_object, "internalAllowAnySecWebSocketKey")?
            .is_some_and(JSValue::to_boolean),
    };""",
1)])
