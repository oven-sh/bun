# Bun

Bun is a fast all-in-one JavaScript runtime. https://bun.com

### Install

```sh
npm install -g bun
```

### Upgrade

```sh
bun upgrade
```

### Supported Platforms

- [macOS, arm64 (Apple Silicon)](https://www.npmjs.com/package/@oven/bun-darwin-aarch64)
- [macOS, x64](https://www.npmjs.com/package/@oven/bun-darwin-x64)
- [Linux, arm64](https://www.npmjs.com/package/@oven/bun-linux-aarch64)
- [Linux, x64](https://www.npmjs.com/package/@oven/bun-linux-x64)
- [Windows, x64](https://www.npmjs.com/package/@oven/bun-windows-x64)
- [Windows, arm64](https://www.npmjs.com/package/@oven/bun-windows-aarch64)

The x64 binary targets Nehalem (SSE4.2) and dispatches AVX2/AVX-512 at runtime. The `@oven/bun-*-x64-baseline` packages are published as aliases of the same binary for backward compatibility.

### Future Platforms

- Unix-like variants such as FreeBSD, OpenBSD, etc.
- Android and iOS
