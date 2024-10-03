# Kit's WebSocket Protocol

This format is only intended for communication for the browser build of
`hmr-runtime.ts` <-> `DevServer.zig`. Server-side HMR is implemented using a
different interface. This document is aimed for contributors to these
two components; Any other use-case is unsupported.

Every message is to use `.binary`/`ArrayBuffer` transport mode. The first byte
indicates a Message ID, with the length being inferred by the payload size.

## Server->Client messages

### `V`

Version payload. Sent on connection startup. The client should issue a hard-reload
when it does not match the embedded version.

Example:

```
V1.1.30-canary.37+117e1b388
```

### `(`

Hot-module-reloading patch. The entire payload is UTF-8 Encoded JavaScript Payload.

### `R`

Server-side code has reloaded. Client should either refetch the route or perform a hard reload.

TODO: pass route(s) changed so the client can only update when it matches the route.
