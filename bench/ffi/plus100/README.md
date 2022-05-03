## FFI overhead comparison

This compares the cost of simple function calls going from JavaScript to native code and back in:

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

**add 100 to a number**:

| Overhead | Using   | Version | Platform        |
| -------- | ------- | ------- | --------------- |
| 7ns      | bun:ffi | 0.0.79  | macOS (aarch64) |
| 18ns     | napi.rs | 17.7.1  | macOS (aarch64) |
| 580ns    | Deno    | 1.21.1  | macOS (aarch64) |

**function that does nothing**:

| Overhead | Using   | Version | Platform        |
| -------- | ------- | ------- | --------------- |
| 3ns      | bun:ffi | 0.0.79  | macOS (aarch64) |
| 15ns     | napi.rs | 17.7.1  | macOS (aarch64) |
| 431ns    | Deno    | 1.21.1  | macOS (aarch64) |

The native [functions](./plus100.c) called in Deno & Bun are the same. The function called with napi.rs is based on napi's official [package-template](https://github.com/napi-rs/package-template) in https://github.com/Jarred-Sumner/napi-plus100
