import * as b from "../../codegen/bindgen-lib.ts";

/** The promise reactions of `RequestContext<ThisServer, SSL, DEBUG, MUX>`, which C++ tells apart by their address. */
function reactions(debug: boolean, mux: boolean, ssl: boolean) {
  const context = `HTTPRequestContext${debug ? "Debug" : ""}${mux ? "Mux" : ""}${ssl ? "TLS" : ""}`;
  const server = `crate::server::${debug ? "Debug" : ""}HTTP${ssl ? "S" : ""}Server`;
  const rustPath = `crate::server::request_context::RequestContext::<${server}, ${ssl}, ${debug}, ${mux}>`;
  const reaction = (name: string, rustName: string, contextType: b.Type = b.nativePromiseContext(rustPath)) =>
    b.fn({
      export: `Bun__${context}__${name}`,
      args: { value: b.any, context: contextType },
      capability: "js",
      rustPath: `${rustPath}::${rustName}`,
    });
  return [
    reaction("onResolve", "on_resolve"),
    // After an upgrade the cell holds the server, which reports the rejection.
    reaction("onReject", "on_reject", b.nativePromiseContext(rustPath).withValue),
    reaction("onResolveStream", "on_resolve_stream"),
    reaction("onRejectStream", "on_reject_stream"),
  ];
}

export const [onResolve, onReject, onResolveStream, onRejectStream] = reactions(false, false, false);
export const [onResolveTLS, onRejectTLS, onResolveStreamTLS, onRejectStreamTLS] = reactions(false, false, true);
export const [onResolveDebug, onRejectDebug, onResolveStreamDebug, onRejectStreamDebug] = reactions(true, false, false);
export const [onResolveDebugTLS, onRejectDebugTLS, onResolveStreamDebugTLS, onRejectStreamDebugTLS] = reactions(
  true,
  false,
  true,
);
export const [onResolveMux, onRejectMux, onResolveStreamMux, onRejectStreamMux] = reactions(false, true, false);
export const [onResolveMuxTLS, onRejectMuxTLS, onResolveStreamMuxTLS, onRejectStreamMuxTLS] = reactions(
  false,
  true,
  true,
);
export const [onResolveDebugMux, onRejectDebugMux, onResolveStreamDebugMux, onRejectStreamDebugMux] = reactions(
  true,
  true,
  false,
);
export const [onResolveDebugMuxTLS, onRejectDebugMuxTLS, onResolveStreamDebugMuxTLS, onRejectStreamDebugMuxTLS] =
  reactions(true, true, true);
