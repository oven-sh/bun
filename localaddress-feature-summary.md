# LocalAddress Support in fetch()

## Summary
This implementation adds `localAddress` support to the `fetch()` function, allowing users to specify the local IP address to bind to when making HTTP requests. This is similar to Node.js's `localAddress` option and curl's `--interface` flag.

## Usage

```javascript
// Bind to a specific local IP address
const response = await fetch("https://example.com", {
  localAddress: "192.168.1.100"
});

// Works with other fetch options
const response = await fetch("https://api.example.com/data", {
  method: "POST",
  localAddress: "10.0.0.50",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ data: "example" })
});
```

## Implementation Details

### Modified Files

1. **src/bun.js/webcore/fetch.zig**
   - Added `local_address` variable extraction from fetch options
   - Added `local_address` field to `FetchOptions` struct
   - Added cleanup for `local_address` in multiple locations

2. **src/http.zig** 
   - Added `local_address: jsc.ZigString.Slice` field to `HTTPClient`
   - Added cleanup for `local_address` in deinit functions

3. **src/http/AsyncHTTP.zig**
   - Added `local_address` field to `Options` struct
   - Added support for `local_address` in the `init` function
   - Added cleanup for `local_address` in `clearData` function

4. **src/http/HTTPContext.zig**
   - Modified `connect` function to use `connectAnonWithLocalAddress` when local address is provided
   - Falls back to regular `connectAnon` when no local address is specified

5. **src/deps/uws/socket.zig**
   - Added `connectAnonWithLocalAddress` function that accepts optional local address parameter
   - Implemented connection logic using new usockets API

6. **src/deps/uws/SocketContext.zig**
   - Added `connectWithLocalAddress` wrapper method
   - Added extern declaration for `us_socket_context_connect_with_local_address`

7. **packages/bun-usockets/src/libusockets.h**
   - Added declaration for `us_socket_context_connect_with_local_address` function

8. **packages/bun-usockets/src/context.c**
   - Implemented `us_socket_context_connect_with_local_address` function
   - Added `us_socket_context_connect_resolved_dns_with_local_address` helper function
   - Added local address parsing and connection logic

9. **packages/bun-usockets/src/bsd.c**
   - Implemented `bsd_create_connect_socket_with_local_address` function
   - Added socket binding to local address before connecting

10. **packages/bun-usockets/src/internal/networking/bsd.h**
    - Added declaration for `bsd_create_connect_socket_with_local_address`

### Architecture

The implementation follows the existing pattern used for unix socket support:

1. **Fetch Level**: Parse `localAddress` option from JavaScript and store in `FetchOptions`
2. **HTTP Client Level**: Store local address in `HTTPClient` and pass through `AsyncHTTP`
3. **Socket Level**: Use conditional logic to call `connectAnonWithLocalAddress` when local address is provided
4. **uSockets Level**: Extend uSockets API to support local address binding
5. **BSD Level**: Implement actual socket binding using `bind()` system call

### Error Handling

- Invalid local addresses fail gracefully and may fall back to regular connection
- SSL connections currently fall back to regular connection (can be extended later)
- Complex DNS resolution cases fall back to regular connection (can be extended later)

### Testing

A comprehensive test suite was created in `test/js/bun/http/fetch-local-address.test.ts` that covers:
- Basic functionality with valid local address
- Error handling with invalid local address  
- Compatibility with existing fetch usage (no regression)

## Limitations

1. **SSL/TLS Support**: Currently SSL connections fall back to regular connection without local address binding. This can be extended in the future.

2. **Complex DNS Resolution**: When multiple IP addresses are returned from DNS resolution, the implementation falls back to regular connection. This can be enhanced to support local address binding in all cases.

3. **IPv6 Support**: While the implementation includes IPv6 support in the socket binding code, it has not been extensively tested with IPv6 local addresses.

## Future Enhancements

1. Add full SSL/TLS support for local address binding
2. Extend support to complex DNS resolution scenarios
3. Add support for specifying local port (currently uses port 0 for any available port)
4. Add more comprehensive IPv6 testing
5. Add support for binding to network interface names (like curl's `--interface`)