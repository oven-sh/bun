## FFI overhead comparison

This compares the cost of a simple function call going from JavaScript to native code and back in:

- Bun v0.0.79
- napi.rs (Node v17.7.1)
- Deno v1.21.1

To set up:

```bash
bun setup
```

To run the benchmark:

```bash
bun bench
```

| Overhead | Using   | Version | Platform        |
| -------- | ------- | ------- | --------------- |
| 7ns      | bun:ffi | 0.0.79  | macOS (aarch64) |
| 18ns     | napi.rs | 17.7.1  | macOS (aarch64) |
| 580ns    | Deno    | 1.21.1  | macOS (aarch64) |

The native [function](./plus100.c) called in Deno & Bun are the same. The function called with napi.rs is from napi's official [package-template](https://github.com/napi-rs/package-template)
