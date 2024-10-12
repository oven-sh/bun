# Kit's WebSocket Protocol

This format is only intended for communication for the browser build of
`hmr-runtime.ts` <-> `DevServer.zig`. Server-side HMR is implemented using a
different interface. This document is aimed for contributors to these
two components; Any other use-case is unsupported.

Every message is to use `.binary`/`ArrayBuffer` transport mode. The first byte
indicates a Message ID, with the length being inferred by the payload size.

All integers are in little-endian

## Client->Server messages

### `v`

Subscribe to visualizer packets (`v`)

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

### `R` - Route reload request

Server-side code has reloaded. Client should either refetch the route or perform a hard reload.

- `u32`: Number of updated routes
- For each route:
  - `u32`: Route ID
  - `u16`: Length of route name.
  - `[n]u8`: Route name in UTF-8 encoded text.

### `e` - Error status update

- `u32`: Number of errors removed
- For each removed error:
  - `u32` Error owner
- Remainder of payload is repeating each error object:
  - `u32` Error owner
  - Error Payload

### `v`

Payload for `incremental_visualizer.html`. This can be accessed via `/_bun/incremental_visualizer`.

- `u32`: Number of files in client graph
- For each file in client graph
  - `u32`: Length of name. If zero then no other fields are provided.
  - `[n]u8`: File path in UTF-8 encoded text
  - `u8`: If file is stale, set 1
  - `u8`: If file is in server graph, set 1
  - `u8`: If file is in ssr graph, set 1
  - `u8`: If file is a server-side route root, set 1
  - `u8`: If file is a server-side component boundary file, set 1
- `u32`: Number of files in the server graph
- For each file in server graph, repeat the same parser for the clienr graph
- `u32`: Number of client edges. For each,
  - `u32`: File index of the dependency file
  - `u32`: File index of the imported file
- `u32`: Number of server edges. For each,
  - `u32`: File index of the dependency file
  - `u32`: File index of the imported file
