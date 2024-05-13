<p align="center">
  <a href="https://bun.sh"><img src="https://user-images.githubusercontent.com/709451/182802334-d9c42afe-f35d-4a7b-86ea-9985f73f20c3.png" alt="Logo" height=170></a>
</p>
<h1 align="center">Bun</h1>

<p align="center">
<a href="https://bun.sh/discord" target="_blank"><img height=20 src="https://img.shields.io/discord/876711213126520882" /></a>
<img src="https://img.shields.io/github/stars/oven-sh/bun" alt="stars">
<a href="https://twitter.com/jarredsumner/status/1542824445810642946"><img src="https://img.shields.io/static/v1?label=speed&message=fast&color=success" alt="Bun speed" /></a>
</p>

<div align="center">
  <a href="https://bun.sh/docs">Documentation</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://discord.com/invite/CXdq2DP29u">Discord</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://github.com/oven-sh/bun/issues/new">Issues</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://github.com/oven-sh/bun/issues/159">Roadmap</a>
  <br />
</div>

### [Read the docs →](https://bun.sh/docs)

## What is Bun?

> **Bun is under active development.** Use it to speed up your development workflows or run simpler production code in resource-constrained environments like serverless functions. We're working on more complete Node.js compatibility and integration with existing frameworks. Join the [Discord](https://bun.sh/discord) and watch the [GitHub repository](https://github.com/oven-sh/bun) to keep tabs on future releases.

Bun is an all-in-one toolkit for JavaScript and TypeScript apps. It ships as a single executable called `bun`.

At its core is the _Bun runtime_, a fast JavaScript runtime designed as a drop-in replacement for Node.js. It's written in Zig and powered by JavaScriptCore under the hood, dramatically reducing startup times and memory usage.

```bash
bun run index.tsx             # TS and JSX supported out-of-the-box
```

The `bun` command-line tool also implements a test runner, script runner, and Node.js-compatible package manager. Instead of 1,000 node_modules for development, you only need `bun`. Bun's built-in tools are significantly faster than existing options and usable in existing Node.js projects with little to no changes.

```bash
bun test                      # run tests
bun run start                 # run the `start` script in `package.json`
bun install <pkg>             # install a package
bunx cowsay 'Hello, world!'   # execute a package
```

## Install

Bun supports Linux (x64 & arm64), macOS (x64 & Apple Silicon) and Windows (x64).

> **Linux users** — Kernel version 5.6 or higher is strongly recommended, but the minimum is 5.1.

```sh
# with install script (recommended)
curl -fsSL https://bun.sh/install | bash

# on windows
powershell -c "irm bun.sh/install.ps1 | iex"

# with npm
npm install -g bun

# with Homebrew
brew tap oven-sh/bun
brew install bun

# with Docker
docker pull oven/bun
docker run --rm --init --ulimit memlock=-1:-1 oven/bun
```

### Upgrade

To upgrade to the latest version of Bun, run:

```sh
bun upgrade
```

Bun automatically releases a canary build on every commit to `main`. To upgrade to the latest canary build, run:

```sh
bun upgrade --canary
```

[View canary build](https://github.com/oven-sh/bun/releases/tag/canary)

## Quick links

- Intro
  - [What is Bun?](https://bun.sh/docs/index)
  - [Installation](https://bun.sh/docs/installation)
  - [Quickstart](https://bun.sh/docs/quickstart)
  - [TypeScript](https://bun.sh/docs/typescript)

- Templating
  - [`bun init`](https://bun.sh/docs/cli/init)
  - [`bun create`](https://bun.sh/docs/cli/bun-create)

- Runtime
  - [`bun run`](https://bun.sh/docs/cli/run)
  - [File types](https://bun.sh/docs/runtime/loaders)
  - [TypeScript](https://bun.sh/docs/runtime/typescript)
  - [JSX](https://bun.sh/docs/runtime/jsx)
  - [Environment variables](https://bun.sh/docs/runtime/env)
  - [Bun APIs](https://bun.sh/docs/runtime/bun-apis)
  - [Web APIs](https://bun.sh/docs/runtime/web-apis)
  - [Node.js compatibility](https://bun.sh/docs/runtime/nodejs-apis)
  - [Single-file executable](https://bun.sh/docs/bundler/executables)
  - [Plugins](https://bun.sh/docs/runtime/plugins)
  - [Watch mode](https://bun.sh/docs/runtime/hot)
  - [Module resolution](https://bun.sh/docs/runtime/modules)
  - [Auto-install](https://bun.sh/docs/runtime/autoimport)
  - [bunfig.toml](https://bun.sh/docs/runtime/bunfig)
  - [Debugger](https://bun.sh/docs/runtime/debugger)
  - [Framework API](https://bun.sh/docs/runtime/framework)

- Package manager
  - [`bun install`](https://bun.sh/docs/cli/install)
  - [`bun add`](https://bun.sh/docs/cli/add)
  - [`bun remove`](https://bun.sh/docs/cli/remove)
  - [`bun update`](https://bun.sh/docs/cli/update)
  - [`bun link`](https://bun.sh/docs/cli/link)
  - [`bun pm`](https://bun.sh/docs/cli/pm)
  - [Global cache](https://bun.sh/docs/install/cache)
  - [Workspaces](https://bun.sh/docs/install/workspaces)
  - [Lifecycle scripts](https://bun.sh/docs/install/lifecycle)
  - [Filter](https://bun.sh/docs/cli/filter)
  - [Lockfile](https://bun.sh/docs/install/lockfile)
  - [Scopes and registries](https://bun.sh/docs/install/registries)
  - [Overrides and resolutions](https://bun.sh/docs/install/overrides)

- Bundler
  - [`Bun.build`](https://bun.sh/docs/bundler)
  - [Loaders](https://bun.sh/docs/bundler/loaders)
  - [Plugins](https://bun.sh/docs/bundler/plugins)
  - [Macros](https://bun.sh/docs/bundler/macros)
  - [vs esbuild](https://bun.sh/docs/bundler/vs-esbuild)

- Test runner
  - [`bun test`](https://bun.sh/docs/cli/test)
  - [Writing tests](https://bun.sh/docs/test/writing)
  - [Watch mode](https://bun.sh/docs/test/hot)
  - [Lifecycle hooks](https://bun.sh/docs/test/lifecycle)
  - [Mocks](https://bun.sh/docs/test/mocks)
  - [Snapshots](https://bun.sh/docs/test/snapshots)
  - [Dates and times](https://bun.sh/docs/test/time)
  - [DOM testing](https://bun.sh/docs/test/dom)
  - [Code coverage](https://bun.sh/docs/test/coverage)

- Package runner
  - [`bunx`](https://bun.sh/docs/cli/bunx)

- API
  - [HTTP server](https://bun.sh/docs/api/http)
  - [WebSockets](https://bun.sh/docs/api/websockets)
  - [Workers](https://bun.sh/docs/api/workers)
  - [Binary data](https://bun.sh/docs/api/binary-data)
  - [Streams](https://bun.sh/docs/api/streams)
  - [File I/O](https://bun.sh/docs/api/file-io)
  - [import.meta](https://bun.sh/docs/api/import-meta)
  - [SQLite](https://bun.sh/docs/api/sqlite)
  - [FileSystemRouter](https://bun.sh/docs/api/file-system-router)
  - [TCP sockets](https://bun.sh/docs/api/tcp)
  - [UDP sockets](https://bun.sh/docs/api/udp)
  - [Globals](https://bun.sh/docs/api/globals)
  - [$ Shell](https://bun.sh/docs/runtime/shell)
  - [Child processes](https://bun.sh/docs/api/spawn)
  - [Transpiler](https://bun.sh/docs/api/transpiler)
  - [Hashing](https://bun.sh/docs/api/hashing)
  - [Console](https://bun.sh/docs/api/console)
  - [FFI](https://bun.sh/docs/api/ffi)
  - [HTMLRewriter](https://bun.sh/docs/api/html-rewriter)
  - [Testing](https://bun.sh/docs/api/test)
  - [Utils](https://bun.sh/docs/api/utils)
  - [Node-API](https://bun.sh/docs/api/node-api)
  - [Glob](https://bun.sh/docs/api/glob)
  - [Semver](https://bun.sh/docs/api/semver)

- Project
  - [Roadmap](https://bun.sh/docs/project/roadmap)
  - [Benchmarking](https://bun.sh/docs/project/benchmarking)
  - [Contributing](https://bun.sh/docs/project/contributing)
  - [Building Windows](https://bun.sh/docs/project/building-windows)
  - [License](https://bun.sh/docs/project/licensing)

## Guides 

- Binary 
  - [Convert an ArrayBuffer to an array of numbers](https://bun.sh/docs/guides/arraybuffer-to-array)
  - [Convert an ArrayBuffer to a Blob](https://bun.sh/docs/guides/arraybuffer-to-blob)
  - [Convert an ArrayBuffer to a Buffer](https://bun.sh/docs/guides/arraybuffer-to-buffer)
  - [Convert an ArrayBuffer to a string](https://bun.sh/docs/guides/arraybuffer-to-string)
  - [Convert an ArrayBuffer to a Uint8Array](https://bun.sh/docs/guides/arraybuffer-to-typedarray)
  - [Convert a Blob to an ArrayBuffer](https://bun.sh/docs/guides/blob-to-arraybuffer)
  - [Convert a Blob to a DataView](https://bun.sh/docs/guides/blob-to-dataview)
  - [Convert a Blob to a ReadableStream](https://bun.sh/docs/guides/blob-to-stream)
  - [Convert a Blob to a string](https://bun.sh/docs/guides/blob-to-string)
  - [Convert a Blob to a Uint8Array](https://bun.sh/docs/guides/blob-to-typedarray)
  - [Convert a Buffer to an ArrayBuffer](https://bun.sh/docs/guides/buffer-to-arraybuffer)
  - [Convert a Buffer to a blob](https://bun.sh/docs/guides/buffer-to-blob)
  - [Convert a Buffer to a ReadableStream](https://bun.sh/docs/guides/buffer-to-readablestream)
  - [Convert a Buffer to a string](https://bun.sh/docs/guides/buffer-to-string)
  - [Convert a Buffer to a Uint8Array](https://bun.sh/docs/guides/buffer-to-typedarray)
  - [Convert a DataView to a string](https://bun.sh/docs/guides/dataview-to-string)
  - [Convert a Uint8Array to an ArrayBuffer](https://bun.sh/docs/guides/typedarray-to-arraybuffer)
  - [Convert a Uint8Array to a Blob](https://bun.sh/docs/guides/typedarray-to-blob)
  - [Convert a Uint8Array to a Buffer](https://bun.sh/docs/guides/typedarray-to-buffer)
  - [Convert a Uint8Array to a DataView](https://bun.sh/docs/guides/typedarray-to-dataview)
  - [Convert a Uint8Array to a ReadableStream](https://bun.sh/docs/guides/typedarray-to-readablestream)
  - [Convert a Uint8Array to a string](https://bun.sh/docs/guides/typedarray-to-string)

- Ecosystem 
  - [Build an app with Astro and Bun](https://bun.sh/docs/guides/astro)
  - [Create a Discord bot](https://bun.sh/docs/guides/discordjs)
  - [Containerize a Bun application with Docker](https://bun.sh/docs/guides/docker)
  - [Use Drizzle ORM with Bun](https://bun.sh/docs/guides/drizzle)
  - [Use EdgeDB with Bun](https://bun.sh/docs/guides/edgedb)
  - [Build an HTTP server using Elysia and Bun](https://bun.sh/docs/guides/elysia)
  - [Build an HTTP server using Express and Bun](https://bun.sh/docs/guides/express)
  - [Build an HTTP server using Hono and Bun](https://bun.sh/docs/guides/hono)
  - [Read and write data to MongoDB using Mongoose and Bun](https://bun.sh/docs/guides/mongoose)
  - [Use Neon's Serverless Postgres with Bun](https://bun.sh/docs/guides/neon-serverless-postgres)
  - [Build an app with Next.js and Bun](https://bun.sh/docs/guides/nextjs)
  - [Build an app with Nuxt and Bun](https://bun.sh/docs/guides/nuxt)
  - [Run Bun as a daemon with PM2](https://bun.sh/docs/guides/pm2)
  - [Use Prisma with Bun](https://bun.sh/docs/guides/prisma)
  - [Build an app with Qwik and Bun](https://bun.sh/docs/guides/qwik)
  - [Use React and JSX](https://bun.sh/docs/guides/react)
  - [Build an app with Remix and Bun](https://bun.sh/docs/guides/remix)
  - [Build an app with SolidStart and Bun](https://bun.sh/docs/guides/solidstart)
  - [Server-side render (SSR) a React component](https://bun.sh/docs/guides/ssr-react)
  - [Build an HTTP server using StricJS and Bun](https://bun.sh/docs/guides/stric)
  - [Build an app with SvelteKit and Bun](https://bun.sh/docs/guides/sveltekit)
  - [Run Bun as a daemon with systemd](https://bun.sh/docs/guides/systemd)
  - [Build a frontend using Vite and Bun](https://bun.sh/docs/guides/vite)

- HTTP 
  - [fetch with unix domain sockets in Bun](https://bun.sh/docs/guides/fetch-unix)
  - [Send an HTTP request using fetch](https://bun.sh/docs/guides/fetch)
  - [Upload files via HTTP using FormData](https://bun.sh/docs/guides/file-uploads)
  - [Hot reload an HTTP server](https://bun.sh/docs/guides/hot)
  - [Proxy HTTP requests using fetch()](https://bun.sh/docs/guides/proxy)
  - [Common HTTP server usage](https://bun.sh/docs/guides/server)
  - [Write a simple HTTP server](https://bun.sh/docs/guides/simple)
  - [Stream a file as an HTTP Response](https://bun.sh/docs/guides/stream-file)
  - [Streaming HTTP Server with Async Iterators](https://bun.sh/docs/guides/stream-iterator)
  - [Streaming HTTP Server with Node.js Streams](https://bun.sh/docs/guides/stream-node-streams-in-bun)
  - [Configure TLS on an HTTP server](https://bun.sh/docs/guides/tls)

- Install 
  - [Add a development dependency](https://bun.sh/docs/guides/add-dev)
  - [Add a Git dependency](https://bun.sh/docs/guides/add-git)
  - [Add an optional dependency](https://bun.sh/docs/guides/add-optional)
  - [Add a peer dependency](https://bun.sh/docs/guides/add-peer)
  - [Add a tarball dependency](https://bun.sh/docs/guides/add-tarball)
  - [Add a dependency](https://bun.sh/docs/guides/add)
  - [Using bun install with an Azure Artifacts npm registry](https://bun.sh/docs/guides/azure-artifacts)
  - [Install dependencies with Bun in GitHub Actions](https://bun.sh/docs/guides/cicd)
  - [Override the default npm registry for bun install](https://bun.sh/docs/guides/custom-registry)
  - [Configure git to diff Bun's lockb lockfile](https://bun.sh/docs/guides/git-diff-bun-lockfile)
  - [Using bun install with Artifactory](https://bun.sh/docs/guides/jfrog-artifactory)
  - [Install a package under a different name](https://bun.sh/docs/guides/npm-alias)
  - [Configure a private registry for an organization scope with bun install](https://bun.sh/docs/guides/registry-scope)
  - [Add a trusted dependency](https://bun.sh/docs/guides/trusted)
  - [Configuring a monorepo using workspaces](https://bun.sh/docs/guides/workspaces)
  - [Generate a human-readable lockfile](https://bun.sh/docs/guides/yarnlock)

- Process 
  - [Parse command-line arguments](https://bun.sh/docs/guides/argv)
  - [Listen for CTRL+C](https://bun.sh/docs/guides/ctrl-c)
  - [Spawn a child process and communicate using IPC](https://bun.sh/docs/guides/ipc)
  - [Get the process uptime in nanoseconds](https://bun.sh/docs/guides/nanoseconds)
  - [Listen to OS signals](https://bun.sh/docs/guides/os-signals)
  - [Read stderr from a child process](https://bun.sh/docs/guides/spawn-stderr)
  - [Read stdout from a child process](https://bun.sh/docs/guides/spawn-stdout)
  - [Spawn a child process](https://bun.sh/docs/guides/spawn)
  - [Read from stdin](https://bun.sh/docs/guides/stdin)

- Read file 
  - [Read a file to an ArrayBuffer](https://bun.sh/docs/guides/arraybuffer)
  - [Read a file to a Buffer](https://bun.sh/docs/guides/buffer)
  - [Check if a file exists](https://bun.sh/docs/guides/exists)
  - [Read a JSON file](https://bun.sh/docs/guides/json)
  - [Get the MIME type of a file](https://bun.sh/docs/guides/mime)
  - [Read a file as a ReadableStream](https://bun.sh/docs/guides/stream)
  - [Read a file as a string](https://bun.sh/docs/guides/string)
  - [Read a file to a Uint8Array](https://bun.sh/docs/guides/uint8array)
  - [Watch a directory for changes](https://bun.sh/docs/guides/watch)

- Runtime 
  - [Install and run Bun in GitHub Actions](https://bun.sh/docs/guides/cicd)
  - [Define and replace static globals & constants](https://bun.sh/docs/guides/define-constant)
  - [Import HTML file as text](https://bun.sh/docs/guides/import-html)
  - [Import a JSON file](https://bun.sh/docs/guides/import-json)
  - [Import a TOML file](https://bun.sh/docs/guides/import-toml)
  - [Read environment variables](https://bun.sh/docs/guides/read-env)
  - [Set environment variables](https://bun.sh/docs/guides/set-env)
  - [Run a Shell Command](https://bun.sh/docs/guides/shell)
  - [Set a time zone in Bun](https://bun.sh/docs/guides/timezone)
  - [Re-map import paths](https://bun.sh/docs/guides/tsconfig-paths)
  - [Install TypeScript declarations for Bun](https://bun.sh/docs/guides/typescript)
  - [Debugging Bun with the VS Code extension](https://bun.sh/docs/guides/vscode-debugger)
  - [Debugging Bun with the web debugger](https://bun.sh/docs/guides/web-debugger)

- Streams 
  - [Convert a Node.js Readable to an ArrayBuffer](https://bun.sh/docs/guides/node-readable-to-arraybuffer)
  - [Convert a Node.js Readable to a Blob](https://bun.sh/docs/guides/node-readable-to-blob)
  - [Convert a Node.js Readable to JSON](https://bun.sh/docs/guides/node-readable-to-json)
  - [Convert a Node.js Readable to a string](https://bun.sh/docs/guides/node-readable-to-string)
  - [Convert a ReadableStream to an array of chunks](https://bun.sh/docs/guides/to-array)
  - [Convert a ReadableStream to an ArrayBuffer](https://bun.sh/docs/guides/to-arraybuffer)
  - [Convert a ReadableStream to a Blob](https://bun.sh/docs/guides/to-blob)
  - [Convert a ReadableStream to a Buffer](https://bun.sh/docs/guides/to-buffer)
  - [Convert a ReadableStream to JSON](https://bun.sh/docs/guides/to-json)
  - [Convert a ReadableStream to a string](https://bun.sh/docs/guides/to-string)
  - [Convert a ReadableStream to a Uint8Array](https://bun.sh/docs/guides/to-typedarray)

- Test 
  - [Bail early with the Bun test runner](https://bun.sh/docs/guides/bail)
  - [Set a code coverage threshold with the Bun test runner](https://bun.sh/docs/guides/coverage-threshold)
  - [Generate code coverage reports with the Bun test runner](https://bun.sh/docs/guides/coverage)
  - [Write browser DOM tests with Bun and happy-dom](https://bun.sh/docs/guides/happy-dom)
  - [Migrate from Jest to Bun's test runner](https://bun.sh/docs/guides/migrate-from-jest)
  - [Set the system time in Bun's test runner](https://bun.sh/docs/guides/mock-clock)
  - [Mock functions in `bun test`](https://bun.sh/docs/guides/mock-functions)
  - [Re-run tests multiple times with the Bun test runner](https://bun.sh/docs/guides/rerun-each)
  - [Run your tests with the Bun test runner](https://bun.sh/docs/guides/run-tests)
  - [Skip tests with the Bun test runner](https://bun.sh/docs/guides/skip-tests)
  - [Use snapshot testing in `bun test`](https://bun.sh/docs/guides/snapshot)
  - [Spy on methods in `bun test`](https://bun.sh/docs/guides/spy-on)
  - [Set a per-test timeout with the Bun test runner](https://bun.sh/docs/guides/timeout)
  - [Mark a test as a "todo" with the Bun test runner](https://bun.sh/docs/guides/todo-tests)
  - [Update snapshots in `bun test`](https://bun.sh/docs/guides/update-snapshots)
  - [Run tests in watch mode with Bun](https://bun.sh/docs/guides/watch-mode)

- Util 
  - [Encode and decode base64 strings](https://bun.sh/docs/guides/base64)
  - [Check if two objects are deeply equal](https://bun.sh/docs/guides/deep-equals)
  - [Compress and decompress data with DEFLATE](https://bun.sh/docs/guides/deflate)
  - [Detect when code is executed with Bun](https://bun.sh/docs/guides/detect-bun)
  - [Check if the current file is the entrypoint](https://bun.sh/docs/guides/entrypoint)
  - [Escape an HTML string](https://bun.sh/docs/guides/escape-html)
  - [Convert a file URL to an absolute path](https://bun.sh/docs/guides/file-url-to-path)
  - [Compress and decompress data with gzip](https://bun.sh/docs/guides/gzip)
  - [Hash a password](https://bun.sh/docs/guides/hash-a-password)
  - [Get the directory of the current file](https://bun.sh/docs/guides/import-meta-dir)
  - [Get the file name of the current file](https://bun.sh/docs/guides/import-meta-file)
  - [Get the absolute path of the current file](https://bun.sh/docs/guides/import-meta-path)
  - [Get the absolute path to the current entrypoint](https://bun.sh/docs/guides/main)
  - [Convert an absolute path to a file URL](https://bun.sh/docs/guides/path-to-file-url)
  - [Sleep for a fixed number of milliseconds](https://bun.sh/docs/guides/sleep)
  - [Get the current Bun version](https://bun.sh/docs/guides/version)
  - [Get the path to an executable bin file](https://bun.sh/docs/guides/which-path-to-executable-bin)

- WebSocket 
  - [Enable compression for WebSocket messages](https://bun.sh/docs/guides/compression)
  - [Set per-socket contextual data on a WebSocket](https://bun.sh/docs/guides/context)
  - [Build a publish-subscribe WebSocket server](https://bun.sh/docs/guides/pubsub)
  - [Build a simple WebSocket server](https://bun.sh/docs/guides/simple)

- Write file 
  - [Append content to a file](https://bun.sh/docs/guides/append)
  - [Write a string to a file](https://bun.sh/docs/guides/basic)
  - [Write a Blob to a file](https://bun.sh/docs/guides/blob)
  - [Write a file to stdout](https://bun.sh/docs/guides/cat)
  - [Copy a file to another location](https://bun.sh/docs/guides/file-cp)
  - [Write a file incrementally](https://bun.sh/docs/guides/filesink)
  - [Write a Response to a file](https://bun.sh/docs/guides/response)
  - [Write to stdout](https://bun.sh/docs/guides/stdout)
  - [Write a ReadableStream to a file](https://bun.sh/docs/guides/stream)
  - [Delete a file](https://bun.sh/docs/guides/unlink)

## Contributing

Refer to the [Project > Contributing](https://bun.sh/docs/project/contributing) guide to start contributing to Bun.

## License

Refer to the [Project > License](https://bun.sh/docs/project/licensing) page for information about Bun's licensing.
