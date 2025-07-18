---
name: Build-time constants with --define
---

The `--define` flag can be used with `bun build` and `bun build --compile` to inject build-time constants into your application. This is especially useful for embedding metadata like build versions, timestamps, or configuration flags directly into your compiled executables.

```sh
$ bun build --compile --define BUILD_VERSION='"1.2.3"' --define BUILD_TIME='"2024-01-15T10:30:00Z"' src/index.ts --outfile myapp
```

---

## Why use build-time constants?

Build-time constants are embedded directly into your compiled code, making them:

- **Zero runtime overhead** - No environment variable lookups or file reads
- **Immutable** - Values are baked into the binary at compile time
- **Optimizable** - Dead code elimination can remove unused branches
- **Secure** - No external dependencies or configuration files to manage

This is similar to `gcc -D` or `#define` in C/C++, but for JavaScript/TypeScript.

---

## Basic usage

### With `bun build`

```sh
# Bundle with build-time constants
$ bun build --define BUILD_VERSION='"1.0.0"' --define NODE_ENV='"production"' src/index.ts --outdir ./dist
```

### With `bun build --compile`

```sh
# Compile to executable with build-time constants
$ bun build --compile --define BUILD_VERSION='"1.0.0"' --define BUILD_TIME='"2024-01-15T10:30:00Z"' src/cli.ts --outfile mycli
```

### JavaScript API

```ts
await Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  define: {
    BUILD_VERSION: '"1.0.0"',
    BUILD_TIME: '"2024-01-15T10:30:00Z"',
    DEBUG: "false",
  },
});
```

---

## Common use cases

### Version information

Embed version and build metadata directly into your executable:

{% codetabs %}

```ts#src/version.ts
// These constants are replaced at build time
declare const BUILD_VERSION: string;
declare const BUILD_TIME: string;
declare const GIT_COMMIT: string;

export function getVersion() {
  return {
    version: BUILD_VERSION,
    buildTime: BUILD_TIME,
    commit: GIT_COMMIT,
  };
}
```

```sh#Build command
$ bun build --compile \
  --define BUILD_VERSION='"1.2.3"' \
  --define BUILD_TIME='"2024-01-15T10:30:00Z"' \
  --define GIT_COMMIT='"abc123"' \
  src/cli.ts --outfile mycli
```

{% /codetabs %}

### Feature flags

Use build-time constants to enable/disable features:

```ts
// Replaced at build time
declare const ENABLE_ANALYTICS: boolean;
declare const ENABLE_DEBUG: boolean;

function trackEvent(event: string) {
  if (ENABLE_ANALYTICS) {
    // This entire block is removed if ENABLE_ANALYTICS is false
    console.log("Tracking:", event);
  }
}

if (ENABLE_DEBUG) {
  console.log("Debug mode enabled");
}
```

```sh
# Production build - analytics enabled, debug disabled
$ bun build --compile --define ENABLE_ANALYTICS=true --define ENABLE_DEBUG=false src/app.ts --outfile app-prod

# Development build - both enabled
$ bun build --compile --define ENABLE_ANALYTICS=false --define ENABLE_DEBUG=true src/app.ts --outfile app-dev
```

### Configuration

Replace configuration objects at build time:

```ts
declare const CONFIG: {
  apiUrl: string;
  timeout: number;
  retries: number;
};

// CONFIG is replaced with the actual object at build time
const response = await fetch(CONFIG.apiUrl, {
  timeout: CONFIG.timeout,
});
```

```sh
$ bun build --compile --define 'CONFIG={"apiUrl":"https://api.example.com","timeout":5000,"retries":3}' src/app.ts --outfile app
```

---

## Advanced patterns

### Environment-specific builds

Create different executables for different environments:

```json
{
  "scripts": {
    "build:dev": "bun build --compile --define NODE_ENV='\"development\"' --define API_URL='\"http://localhost:3000\"' src/app.ts --outfile app-dev",
    "build:staging": "bun build --compile --define NODE_ENV='\"staging\"' --define API_URL='\"https://staging.example.com\"' src/app.ts --outfile app-staging",
    "build:prod": "bun build --compile --define NODE_ENV='\"production\"' --define API_URL='\"https://api.example.com\"' src/app.ts --outfile app-prod"
  }
}
```

### Using shell commands for dynamic values

Generate build-time constants from shell commands:

```sh
# Use git to get current commit and timestamp
$ bun build --compile \
  --define BUILD_VERSION="\"$(git describe --tags --always)\"" \
  --define BUILD_TIME="\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"" \
  --define GIT_COMMIT="\"$(git rev-parse HEAD)\"" \
  src/cli.ts --outfile mycli
```

### Build automation script

Create a build script that automatically injects build metadata:

```ts
// build.ts
import { $ } from "bun";

const version = await $`git describe --tags --always`.text();
const buildTime = new Date().toISOString();
const gitCommit = await $`git rev-parse HEAD`.text();

await Bun.build({
  entrypoints: ["./src/cli.ts"],
  outdir: "./dist",
  define: {
    BUILD_VERSION: JSON.stringify(version.trim()),
    BUILD_TIME: JSON.stringify(buildTime),
    GIT_COMMIT: JSON.stringify(gitCommit.trim()),
  },
});

console.log(`Built with version ${version.trim()}`);
```

---

## Important considerations

### Value format

Values must be valid JSON that will be parsed and inlined as JavaScript expressions:

```sh
# ✅ Strings must be JSON-quoted
--define VERSION='"1.0.0"'

# ✅ Numbers are JSON literals
--define PORT=3000

# ✅ Booleans are JSON literals
--define DEBUG=true

# ✅ Objects and arrays (use single quotes to wrap the JSON)
--define 'CONFIG={"host":"localhost","port":3000}'

# ✅ Arrays work too
--define 'FEATURES=["auth","billing","analytics"]'

# ❌ This won't work - missing quotes around string
--define VERSION=1.0.0
```

### Property keys

You can use property access patterns as keys, not just simple identifiers:

```sh
# ✅ Replace process.env.NODE_ENV with "production"
--define 'process.env.NODE_ENV="production"'

# ✅ Replace process.env.API_KEY with the actual key
--define 'process.env.API_KEY="abc123"'

# ✅ Replace nested properties
--define 'window.myApp.version="1.0.0"'

# ✅ Replace array access
--define 'process.argv[2]="--production"'
```

This is particularly useful for environment variables:

```ts
// Before compilation
if (process.env.NODE_ENV === "production") {
  console.log("Production mode");
}

// After compilation with --define 'process.env.NODE_ENV="production"'
if ("production" === "production") {
  console.log("Production mode");
}

// After optimization
console.log("Production mode");
```

### TypeScript declarations

For TypeScript projects, declare your constants to avoid type errors:

```ts
// types/build-constants.d.ts
declare const BUILD_VERSION: string;
declare const BUILD_TIME: string;
declare const NODE_ENV: "development" | "staging" | "production";
declare const DEBUG: boolean;
```

### Cross-platform compatibility

When building for multiple platforms, constants work the same way:

```sh
# Linux
$ bun build --compile --target=bun-linux-x64 --define PLATFORM='"linux"' src/app.ts --outfile app-linux

# macOS
$ bun build --compile --target=bun-darwin-x64 --define PLATFORM='"darwin"' src/app.ts --outfile app-macos

# Windows
$ bun build --compile --target=bun-windows-x64 --define PLATFORM='"windows"' src/app.ts --outfile app-windows.exe
```

---

## Related

- [Define constants at runtime](/guides/runtime/define-constant) - Using `--define` with `bun run`
- [Building executables](/bundler/executables) - Complete guide to `bun build --compile`
- [Bundler API](/bundler) - Full bundler documentation including `define` option
