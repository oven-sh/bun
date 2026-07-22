p = "src/js/internal/debugger.ts"
s = open(p).read()
def rep(old, new, n=1):
    global s
    assert s.count(old) == n, (s.count(old), old[:60])
    s = s.replace(old, new)

# 1. exported entrypoint signature
rep("""  isNodeInspector: boolean,
  reportNodeInspectorServerStarted: (url: string, controlCallback?: (message: string) => void, error?: string) => void,
): void {""",
"""  isNodeInspector: boolean,
  reportNodeInspectorServerStarted: (url: string, controlCallback?: (message: string) => void, error?: string) => void,
  enableNodeCDP: boolean,
): void {""")

# 2. CLI path constructs the Debugger with CDP enabled
rep("""  let debug: Debugger | undefined;
  try {
    debug = new Debugger(executionContextId, url, createBackend, send, close);
  } catch (error) {
    exit("Failed to start inspector:\\n", error);
  }""",
"""  let debug: Debugger | undefined;
  try {
    debug = new Debugger(executionContextId, url, createBackend, send, close, false, enableNodeCDP);
  } catch (error) {
    exit("Failed to start inspector:\\n", error);
  }""")

# 3. banner
rep("""        Bun.write(Bun.stderr, dim("--------------------- Bun Inspector ---------------------") + reset() + "\\n");
      }
    } else {""",
"""        Bun.write(Bun.stderr, dim("--------------------- Bun Inspector ---------------------") + reset() + "\\n");
        // Node's inspector banner, verbatim, for the CDP endpoint that is
        // served alongside the JSC one. Tools that scrape stderr for
        // "Debugger listening on ws://..." (Node's own inspector test helper,
        // chrome://inspect wrappers, IDE launchers) key off this exact line.
        const cdpUrl = debug.cdpUrl;
        if (cdpUrl) {
          Bun.write(
            Bun.stderr,
            `Debugger listening on ${cdpUrl}\\nFor help, see: https://nodejs.org/en/docs/inspector\\n`,
          );
        }
      }
    } else {""")

# 4. Debugger fields
rep("""  // node:inspector mode: connections speak the V8 Chrome DevTools Protocol and
  // /json discovery endpoints are served.
  #nodeInspector = false;
  #server?: WebSocketServer;""",
"""  // node:inspector mode: connections speak the V8 Chrome DevTools Protocol and
  // /json discovery endpoints are served.
  #nodeInspector = false;
  // --inspect* mode: the JSC-protocol pathname above keeps working unchanged,
  // and this second pathname (plus the /json discovery endpoints) is served for
  // clients that speak the V8 Chrome DevTools Protocol.
  #cdpPathname?: string;
  #enableNodeCDP = false;
  #server?: WebSocketServer;""")

rep("""    isNodeInspector: boolean = false,
  ) {
    this.#nodeInspector = isNodeInspector;""",
"""    isNodeInspector: boolean = false,
    enableNodeCDP: boolean = false,
  ) {
    this.#nodeInspector = isNodeInspector;
    this.#enableNodeCDP = enableNodeCDP;""")

# 5. url getters
rep("""  get url(): URL | undefined {
    return this.#url;
  }""",
"""  get url(): URL | undefined {
    return this.#url;
  }

  // The ws:// URL of the CDP endpoint, when one is served alongside the
  // JSC-protocol endpoint (--inspect*). Undefined for node:inspector servers,
  // whose only endpoint already speaks CDP, and for non-listening modes.
  get cdpUrl(): string | undefined {
    if (!this.#cdpPathname || !this.#url) return undefined;
    return `ws://${this.#url.host}${this.#cdpPathname}`;
  }""")

# 6. allocate the CDP pathname once the server is listening
rep("""      this.#server = server;
      this.#url!.hostname = server.hostname;
      this.#url!.port = `${server.port}`;
      return;""",
"""      this.#server = server;
      this.#url!.hostname = server.hostname;
      this.#url!.port = `${server.port}`;
      if (this.#enableNodeCDP) {
        // A distinct random pathname, like the JSC one, so it also acts as a
        // bearer token: knowing the port is not enough to attach.
        this.#cdpPathname = `/${randomId()}`;
      }
      return;""")

# 7. targets take the pathname to advertise
rep("""  #nodeInspectorTargets(host: string | null): unknown[] {
    const { hostname, port, pathname } = this.#url!;
    const id = pathname.slice(1);""",
"""  #nodeInspectorTargets(host: string | null): unknown[] {
    const { hostname, port } = this.#url!;
    // For --inspect*, discovery must point CDP clients at the CDP pathname, not
    // at the JSC-protocol one they cannot speak.
    const pathname = this.#cdpPathname ?? this.#url!.pathname;
    const id = pathname.slice(1);""")

# 8. /json gating
rep("""        if (this.#nodeInspector) {
          return Response.json(this.#nodeInspectorTargets(headers.get("Host")));
        }
        break;""",
"""        if (this.#nodeInspector || this.#cdpPathname) {
          return Response.json(this.#nodeInspectorTargets(headers.get("Host")));
        }
        break;""")

rep("""      case "/json/version":
        return Response.json(this.#nodeInspector ? nodeVersionInfo() : versionInfo());""",
"""      case "/json/version":
        return Response.json(this.#nodeInspector || this.#cdpPathname ? nodeVersionInfo() : versionInfo());""")

# 9. routing + upgrade
rep("""    if (!isUnix && this.#url!.pathname !== pathname) {
      return new Response(null, {
        status: 404, // Not Found
      });
    }

    const data: Connection = {
      refEventLoop: headers.get("Ref-Event-Loop") === "0",
    };

    if (!server.upgrade(request, { data })) {""",
"""    const isCDP = this.#cdpPathname !== undefined && pathname === this.#cdpPathname;

    if (!isUnix && !isCDP && this.#url!.pathname !== pathname) {
      return new Response(null, {
        status: 404, // Not Found
      });
    }

    const data: Connection = {
      refEventLoop: headers.get("Ref-Event-Loop") === "0",
      isCDP,
    };

    // Node's inspector accepts any Sec-WebSocket-Key; Bun.serve otherwise
    // requires the RFC 6455 shape. Inspector clients written against Node (and
    // Node's own test suite) send keys that fail that check, so opt this server
    // -- and only this server -- out of it.
    if (!server.upgrade(request, { data, internalAllowAnySecWebSocketKey: true })) {""")

# 10. #open branch
rep("""    if (this.#nodeInspector) {""", """    if (this.#nodeInspector || data.isCDP) {""")

# 11. Connection type
rep("""type Connection = {
  refEventLoop: boolean;""",
"""type Connection = {
  refEventLoop: boolean;
  // True for a connection on the CDP pathname of a --inspect* server.
  isCDP?: boolean;""")

open(p, "w").write(s)
print("patched", p)
