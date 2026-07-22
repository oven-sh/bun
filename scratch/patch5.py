def edit(path, pairs):
    s = open(path).read()
    for old, new in pairs:
        assert s.count(old) == 1, (path, s.count(old), old[:60])
        s = s.replace(old, new)
    open(path, "w").write(s)
    print("patched", path)

edit("packages/bun-uws/src/App.h", [(
"""        /* Route upgrade requests whose Sec-WebSocket-Key is present but not the
         * RFC 6455 shape (16 random bytes, base64 = 24 chars) to the upgrade
         * handler anyway, leaving the decision to it. Only meaningful together
         * with a custom `upgrade` handler. Node's inspector protocol does not
         * validate the key, so a Node-compatible inspector endpoint has to
         * accept keys this check would otherwise route to the HTTP handler. */
        bool allowAnySecWebSocketKey = false;""",
"""        /* Also route a present-but-not-24-char Sec-WebSocket-Key to the custom
         * upgrade handler, which then decides. Node's inspector does not
         * validate the key; note the accept header is generated from 24 bytes. */
        bool allowAnySecWebSocketKey = false;"""
)])

edit("src/jsc/Debugger.rs", [(
"""            // A `--inspect*` server keeps speaking the JSC protocol on its own
            // pathname (debug.bun.sh, the VSCode extension), and additionally
            // serves Node's `/json` discovery endpoints plus a second pathname
            // that speaks the V8 CDP, so `node --inspect`-shaped clients can
            // attach. `inspector.open()` servers are CDP-only and already
            // covered by `is_node_inspector`.
            let enable_node_cdp = !is_node_inspector && !is_connect;""",
"""            // A `--inspect*` listener keeps its JSC-protocol pathname and adds
            // Node's `/json` endpoints plus a second, CDP-speaking pathname.
            // `inspector.open()` servers are already CDP-only.
            let enable_node_cdp = !is_node_inspector && !is_connect;"""
)])

edit("src/runtime/server/server_body.rs", [(
"""            // Bun's own WebSocket server enforces the RFC 6455 key shape (16
            // random bytes, base64 = 24 chars), matching `ws`. Node's inspector
            // does not validate the key at all -- it echoes back
            // base64(sha1(key + GUID)) for whatever it was sent -- and clients
            // that talk to it (including Node's own test suite, which sends the
            // literal `key==`) rely on that.
            // `websocket.internalAllowAnySecWebSocketKey` is the opt-in used by
            // the inspector server in `src/js/internal/debugger.ts`; it is
            // deliberately not a documented `Bun.serve()` option, and uWS's own
            // routing gate (App.h) reads the same flag. The key must still be
            // present, since the accept header is computed from it.""",
"""            // Bun enforces the RFC 6455 key shape (base64 of 16 bytes = 24
            // chars), matching `ws`; Node's inspector does not validate it at
            // all. `websocket.internalAllowAnySecWebSocketKey` (undocumented,
            // used only by src/js/internal/debugger.ts, also read by uWS's
            // routing gate in App.h) opts a server out. The key must still be
            // present: the accept header is computed from it."""
)])

edit("src/runtime/server/WebSocketServerContext.rs", [(
"""    /// Internal, undocumented: accept a `Sec-WebSocket-Key` of any non-zero
    /// length on this server. Bun's WebSocket server otherwise enforces the
    /// RFC 6455 shape, matching `ws`; Node's inspector does not validate the
    /// key at all, so the inspector server in `src/js/internal/debugger.ts`
    /// opts out of the check for itself. Not part of the public
    /// `Bun.serve({ websocket })` API.""",
"""    /// Internal, undocumented, not part of `Bun.serve({ websocket })`: accept a
    /// `Sec-WebSocket-Key` of any non-zero length. Only the inspector server in
    /// `src/js/internal/debugger.ts` sets it, to match Node's inspector."""
)])

edit("src/js/internal/debugger.ts", [(
"""        // Node's inspector banner, verbatim, for the CDP endpoint that is
        // served alongside the JSC one. Tools that scrape stderr for
        // "Debugger listening on ws://..." (Node's own inspector test helper,
        // chrome://inspect wrappers, IDE launchers) key off this exact line.
        const cdpUrl = debug.cdpUrl;""",
"""        // Node's banner, verbatim, for the CDP endpoint served alongside the
        // JSC one: Node-shaped tools scrape stderr for this exact line.
        const cdpUrl = debug.cdpUrl;"""
), (
"""  // --inspect* mode: the JSC-protocol pathname above keeps working unchanged,
  // and this second pathname (plus the /json discovery endpoints) is served for
  // clients that speak the V8 Chrome DevTools Protocol.
  #cdpPathname?: string;""",
"""  // --inspect* mode: a second pathname (plus the /json discovery endpoints)
  // serving the V8 CDP. The JSC-protocol pathname above is unaffected.
  #cdpPathname?: string;"""
), (
"""  // The ws:// URL of the CDP endpoint, when one is served alongside the
  // JSC-protocol endpoint (--inspect*). Undefined for node:inspector servers,
  // whose only endpoint already speaks CDP, and for non-listening modes.
  get cdpUrl()""",
"""  // The CDP endpoint's ws:// URL, when one is served alongside the JSC one
  // (--inspect*). Undefined for node:inspector servers and non-listening modes.
  get cdpUrl()"""
), (
"""      if (this.#enableNodeCDP) {
        // A distinct random pathname, like the JSC one, so it also acts as a
        // bearer token: knowing the port is not enough to attach.
        this.#cdpPathname = `/${randomId()}`;
        if (hostname === defaultHostname) {
          // "localhost" resolves to ::1 here, so the listener above is
          // IPv6-only, while Node's inspector listens on 127.0.0.1 and CDP
          // clients routinely dial loopback over IPv4 explicitly. Add a
          // best-effort second listener on the other loopback address, sharing
          // the same handlers, so both families reach the same inspector. This
          // is purely additive -- the primary listener, and the URL reported
          // for it, are unchanged -- and is skipped if the address is taken.
          const otherLoopback = server.hostname === "127.0.0.1" ? "::1" : "127.0.0.1";
          try {
            this.#loopbackServer = Bun.serve({
              hostname: otherLoopback,
              port: server.port,
              fetch: this.#fetch.bind(this),
              websocket: this.#websocket,
            });
          } catch {}
        }
      }""",
"""      if (this.#enableNodeCDP) {
        // A distinct random pathname, like the JSC one, so it also acts as a
        // bearer token: knowing the port is not enough to attach.
        this.#cdpPathname = `/${randomId()}`;
        if (hostname === defaultHostname) {
          // "localhost" binds one address family only, but Node's inspector
          // listens on 127.0.0.1 and CDP clients dial loopback over either
          // family. Additively bind whichever loopback address is still free.
          for (const loopback of ["127.0.0.1", "::1"]) {
            try {
              this.#loopbackServer = Bun.serve({
                hostname: loopback,
                port: server.port,
                fetch: this.#fetch.bind(this),
                websocket: this.#websocket,
              });
              break;
            } catch {
              // Already bound by the primary listener, or unavailable.
            }
          }
        }
      }"""
), (
"""      // Node's inspector accepts a Sec-WebSocket-Key of any length; Bun's
      // WebSocket server otherwise enforces the RFC 6455 shape, matching `ws`.
      // Inspector clients written against Node -- including Node's own test
      // helper, which sends the literal `key==` -- would be rejected at the
      // handshake, so this server, and only this server, opts out.
      internalAllowAnySecWebSocketKey: true,""",
"""      // Node's inspector accepts a Sec-WebSocket-Key of any length (its own
      // test helper sends `key==`); Bun otherwise enforces the RFC 6455 shape,
      // matching `ws`. This server, and only this server, opts out.
      internalAllowAnySecWebSocketKey: true,"""
), (
"""      drain: ws => this.#drain(ws),
      close: ws => this.#close(ws),
      // The cast keeps TypeScript's excess-property check off
      // internalAllowAnySecWebSocketKey, which is intentionally absent from the
      // public WebSocketHandler type.
    } as WebSocketHandler<Connection>;
  }""",
"""      drain: ws => this.#drain(ws),
      close: ws => this.#close(ws),
    };
  }"""
), (
"""  get #websocket(): WebSocketHandler<Connection> {""",
"""  // internalAllowAnySecWebSocketKey is intentionally absent from the public
  // WebSocketHandler type, so widen the return type rather than casting the
  // literal, which would drop checking on every handler in it.
  get #websocket(): WebSocketHandler<Connection> & { internalAllowAnySecWebSocketKey: boolean } {"""
), (
"""        // Unchanged for --inspect*: debug.bun.sh and the VSCode extension
        // identify a Bun target by these fields, and Node's own /json/version
        // payload ("Browser": "node.js/vX") is not something Bun can honestly
        // claim anyway.
        return Response.json""",
"""        // Unchanged for --inspect*: debug.bun.sh and the VSCode extension
        // identify a Bun target by these fields.
        return Response.json"""
), (
"""        // Discovery endpoint used by CDP clients (chrome://inspect, vscode-js-debug)
        // to find the WebSocket URL. Only served for node:inspector servers; the
        // Bun-protocol inspector has no CDP-speaking clients to discover it.""",
"""        // Discovery endpoint used by CDP clients (chrome://inspect,
        // vscode-js-debug) to find the WebSocket URL. Served whenever a
        // CDP endpoint exists, as Node does."""
)])
