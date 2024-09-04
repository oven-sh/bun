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

  - [Convert a Blob to a DataView](https://bun.sh/guides/binary/blob-to-dataview)
  - [Convert a Blob to a ReadableStream](https://bun.sh/guides/binary/blob-to-stream)
  - [Convert a Blob to a string](https://bun.sh/guides/binary/blob-to-string)
  - [Convert a Blob to a Uint8Array](https://bun.sh/guides/binary/blob-to-typedarray)
  - [Convert a Blob to an ArrayBuffer](https://bun.sh/guides/binary/blob-to-arraybuffer)
  - [Convert a Buffer to a blob](https://bun.sh/guides/binary/buffer-to-blob)
  - [Convert a Buffer to a ReadableStream](https://bun.sh/guides/binary/buffer-to-readablestream)
  - [Convert a Buffer to a string](https://bun.sh/guides/binary/buffer-to-string)
  - [Convert a Buffer to a Uint8Array](https://bun.sh/guides/binary/buffer-to-typedarray)
  - [Convert a Buffer to an ArrayBuffer](https://bun.sh/guides/binary/buffer-to-arraybuffer)
  - [Convert a DataView to a string](https://bun.sh/guides/binary/dataview-to-string)
  - [Convert a Uint8Array to a Blob](https://bun.sh/guides/binary/typedarray-to-blob)
  - [Convert a Uint8Array to a Buffer](https://bun.sh/guides/binary/typedarray-to-buffer)
  - [Convert a Uint8Array to a DataView](https://bun.sh/guides/binary/typedarray-to-dataview)
  - [Convert a Uint8Array to a ReadableStream](https://bun.sh/guides/binary/typedarray-to-readablestream)
  - [Convert a Uint8Array to a string](https://bun.sh/guides/binary/typedarray-to-string)
  - [Convert a Uint8Array to an ArrayBuffer](https://bun.sh/guides/binary/typedarray-to-arraybuffer)
  - [Convert an ArrayBuffer to a Blob](https://bun.sh/guides/binary/arraybuffer-to-blob)
  - [Convert an ArrayBuffer to a Buffer](https://bun.sh/guides/binary/arraybuffer-to-buffer)
  - [Convert an ArrayBuffer to a string](https://bun.sh/guides/binary/arraybuffer-to-string)
  - [Convert an ArrayBuffer to a Uint8Array](https://bun.sh/guides/binary/arraybuffer-to-typedarray)
  - [Convert an ArrayBuffer to an array of numbers](https://bun.sh/guides/binary/arraybuffer-to-array)

- Ecosystem

  - [Build a frontend using Vite and Bun](https://bun.sh/guides/ecosystem/vite)
  - [Build an app with Astro and Bun](https://bun.sh/guides/ecosystem/astro)
  - [Build an app with Next.js and Bun](https://bun.sh/guides/ecosystem/nextjs)
  - [Build an app with Nuxt and Bun](https://bun.sh/guides/ecosystem/nuxt)
  - [Build an app with Qwik and Bun](https://bun.sh/guides/ecosystem/qwik)
  - [Build an app with Remix and Bun](https://bun.sh/guides/ecosystem/remix)
  - [Build an app with SolidStart and Bun](https://bun.sh/guides/ecosystem/solidstart)
  - [Build an app with SvelteKit and Bun](https://bun.sh/guides/ecosystem/sveltekit)
  - [Build an HTTP server using Elysia and Bun](https://bun.sh/guides/ecosystem/elysia)
  - [Build an HTTP server using Express and Bun](https://bun.sh/guides/ecosystem/express)
  - [Build an HTTP server using Hono and Bun](https://bun.sh/guides/ecosystem/hono)
  - [Build an HTTP server using StricJS and Bun](https://bun.sh/guides/ecosystem/stric)
  - [Containerize a Bun application with Docker](https://bun.sh/guides/ecosystem/docker)
  - [Create a Discord bot](https://bun.sh/guides/ecosystem/discordjs)
  - [Deploy a Bun application on Render](https://bun.sh/guides/ecosystem/render)
  - [Read and write data to MongoDB using Mongoose and Bun](https://bun.sh/guides/ecosystem/mongoose)
  - [Run Bun as a daemon with PM2](https://bun.sh/guides/ecosystem/pm2)
  - [Run Bun as a daemon with systemd](https://bun.sh/guides/ecosystem/systemd)
  - [Server-side render (SSR) a React component](https://bun.sh/guides/ecosystem/ssr-react)
  - [Use Drizzle ORM with Bun](https://bun.sh/guides/ecosystem/drizzle)
  - [Use EdgeDB with Bun](https://bun.sh/guides/ecosystem/edgedb)
  - [Use Neon's Serverless Postgres with Bun](https://bun.sh/guides/ecosystem/neon-serverless-postgres)
  - [Use Prisma with Bun](https://bun.sh/guides/ecosystem/prisma)
  - [Use React and JSX](https://bun.sh/guides/ecosystem/react)
  - [Add Sentry to a Bun app](https://bun.sh/guides/ecosystem/sentry)

- HTTP

  - [Common HTTP server usage](https://bun.sh/guides/http/server)
  - [Configure TLS on an HTTP server](https://bun.sh/guides/http/tls)
  - [fetch with unix domain sockets in Bun](https://bun.sh/guides/http/fetch-unix)
  - [Hot reload an HTTP server](https://bun.sh/guides/http/hot)
  - [Proxy HTTP requests using fetch()](https://bun.sh/guides/http/proxy)
  - [Send an HTTP request using fetch](https://bun.sh/guides/http/fetch)
  - [Start a cluster of HTTP servers](https://bun.sh/guides/http/cluster)
  - [Stream a file as an HTTP Response](https://bun.sh/guides/http/stream-file)
  - [Streaming HTTP Server with Async Iterators](https://bun.sh/guides/http/stream-iterator)
  - [Streaming HTTP Server with Node.js Streams](https://bun.sh/guides/http/stream-node-streams-in-bun)
  - [Upload files via HTTP using FormData](https://bun.sh/guides/http/file-uploads)
  - [Write a simple HTTP server](https://bun.sh/guides/http/simple)

- Install

  - [Add a dependency](https://bun.sh/guides/install/add)
  - [Add a development dependency](https://bun.sh/guides/install/add-dev)
  - [Add a Git dependency](https://bun.sh/guides/install/add-git)
  - [Add a peer dependency](https://bun.sh/guides/install/add-peer)
  - [Add a tarball dependency](https://bun.sh/guides/install/add-tarball)
  - [Add a trusted dependency](https://bun.sh/guides/install/trusted)
  - [Add an optional dependency](https://bun.sh/guides/install/add-optional)
  - [Configure a private registry for an organization scope with bun install](https://bun.sh/guides/install/registry-scope)
  - [Configure git to diff Bun's lockb lockfile](https://bun.sh/guides/install/git-diff-bun-lockfile)
  - [Configuring a monorepo using workspaces](https://bun.sh/guides/install/workspaces)
  - [Generate a human-readable lockfile](https://bun.sh/guides/install/yarnlock)
  - [Install a package under a different name](https://bun.sh/guides/install/npm-alias)
  - [Install dependencies with Bun in GitHub Actions](https://bun.sh/guides/install/cicd)
  - [Override the default npm registry for bun install](https://bun.sh/guides/install/custom-registry)
  - [Using bun install with an Azure Artifacts npm registry](https://bun.sh/guides/install/azure-artifacts)
  - [Using bun install with Artifactory](https://bun.sh/guides/install/jfrog-artifactory)

- Process

  - [Get the process uptime in nanoseconds](https://bun.sh/guides/process/nanoseconds)
  - [Listen for CTRL+C](https://bun.sh/guides/process/ctrl-c)
  - [Listen to OS signals](https://bun.sh/guides/process/os-signals)
  - [Parse command-line arguments](https://bun.sh/guides/process/argv)
  - [Read from stdin](https://bun.sh/guides/process/stdin)
  - [Read stderr from a child process](https://bun.sh/guides/process/spawn-stderr)
  - [Read stdout from a child process](https://bun.sh/guides/process/spawn-stdout)
  - [Spawn a child process](https://bun.sh/guides/process/spawn)
  - [Spawn a child process and communicate using IPC](https://bun.sh/guides/process/ipc)

- Read file

  - [Check if a file exists](https://bun.sh/guides/read-file/exists)
  - [Get the MIME type of a file](https://bun.sh/guides/read-file/mime)
  - [Read a file as a ReadableStream](https://bun.sh/guides/read-file/stream)
  - [Read a file as a string](https://bun.sh/guides/read-file/string)
  - [Read a file to a Buffer](https://bun.sh/guides/read-file/buffer)
  - [Read a file to a Uint8Array](https://bun.sh/guides/read-file/uint8array)
  - [Read a file to an ArrayBuffer](https://bun.sh/guides/read-file/arraybuffer)
  - [Read a JSON file](https://bun.sh/guides/read-file/json)
  - [Watch a directory for changes](https://bun.sh/guides/read-file/watch)

- Runtime

  - [Debugging Bun with the VS Code extension](https://bun.sh/guides/runtime/vscode-debugger)
  - [Debugging Bun with the web debugger](https://bun.sh/guides/runtime/web-debugger)
  - [Define and replace static globals & constants](https://bun.sh/guides/runtime/define-constant)
  - [Import a JSON file](https://bun.sh/guides/runtime/import-json)
  - [Import a TOML file](https://bun.sh/guides/runtime/import-toml)
  - [Import HTML file as text](https://bun.sh/guides/runtime/import-html)
  - [Install and run Bun in GitHub Actions](https://bun.sh/guides/runtime/cicd)
  - [Install TypeScript declarations for Bun](https://bun.sh/guides/runtime/typescript)
  - [Re-map import paths](https://bun.sh/guides/runtime/tsconfig-paths)
  - [Read environment variables](https://bun.sh/guides/runtime/read-env)
  - [Run a Shell Command](https://bun.sh/guides/runtime/shell)
  - [Set a time zone in Bun](https://bun.sh/guides/runtime/timezone)
  - [Set environment variables](https://bun.sh/guides/runtime/set-env)

- Streams

  - [Convert a Node.js Readable to a Blob](https://bun.sh/guides/streams/node-readable-to-blob)
  - [Convert a Node.js Readable to a string](https://bun.sh/guides/streams/node-readable-to-string)
  - [Convert a Node.js Readable to an ArrayBuffer](https://bun.sh/guides/streams/node-readable-to-arraybuffer)
  - [Convert a Node.js Readable to JSON](https://bun.sh/guides/streams/node-readable-to-json)
  - [Convert a ReadableStream to a Blob](https://bun.sh/guides/streams/to-blob)
  - [Convert a ReadableStream to a Buffer](https://bun.sh/guides/streams/to-buffer)
  - [Convert a ReadableStream to a string](https://bun.sh/guides/streams/to-string)
  - [Convert a ReadableStream to a Uint8Array](https://bun.sh/guides/streams/to-typedarray)
  - [Convert a ReadableStream to an array of chunks](https://bun.sh/guides/streams/to-array)
  - [Convert a ReadableStream to an ArrayBuffer](https://bun.sh/guides/streams/to-arraybuffer)
  - [Convert a ReadableStream to JSON](https://bun.sh/guides/streams/to-json)

- Test

  - [Bail early with the Bun test runner](https://bun.sh/guides/test/bail)
  - [Generate code coverage reports with the Bun test runner](https://bun.sh/guides/test/coverage)
  - [Mark a test as a "todo" with the Bun test runner](https://bun.sh/guides/test/todo-tests)
  - [Migrate from Jest to Bun's test runner](https://bun.sh/guides/test/migrate-from-jest)
  - [Mock functions in `bun test`](https://bun.sh/guides/test/mock-functions)
  - [Re-run tests multiple times with the Bun test runner](https://bun.sh/guides/test/rerun-each)
  - [Run tests in watch mode with Bun](https://bun.sh/guides/test/watch-mode)
  - [Run your tests with the Bun test runner](https://bun.sh/guides/test/run-tests)
  - [Set a code coverage threshold with the Bun test runner](https://bun.sh/guides/test/coverage-threshold)
  - [Set a per-test timeout with the Bun test runner](https://bun.sh/guides/test/timeout)
  - [Set the system time in Bun's test runner](https://bun.sh/guides/test/mock-clock)
  - [Skip tests with the Bun test runner](https://bun.sh/guides/test/skip-tests)
  - [Spy on methods in `bun test`](https://bun.sh/guides/test/spy-on)
  - [Update snapshots in `bun test`](https://bun.sh/guides/test/update-snapshots)
  - [Use snapshot testing in `bun test`](https://bun.sh/guides/test/snapshot)
  - [Write browser DOM tests with Bun and happy-dom](https://bun.sh/guides/test/happy-dom)

- Util

  - [Check if the current file is the entrypoint](https://bun.sh/guides/util/entrypoint)
  - [Check if two objects are deeply equal](https://bun.sh/guides/util/deep-equals)
  - [Compress and decompress data with DEFLATE](https://bun.sh/guides/util/deflate)
  - [Compress and decompress data with gzip](https://bun.sh/guides/util/gzip)
  - [Convert a file URL to an absolute path](https://bun.sh/guides/util/file-url-to-path)
  - [Convert an absolute path to a file URL](https://bun.sh/guides/util/path-to-file-url)
  - [Detect when code is executed with Bun](https://bun.sh/guides/util/detect-bun)
  - [Encode and decode base64 strings](https://bun.sh/guides/util/base64)
  - [Escape an HTML string](https://bun.sh/guides/util/escape-html)
  - [Get the absolute path of the current file](https://bun.sh/guides/util/import-meta-path)
  - [Get the absolute path to the current entrypoint](https://bun.sh/guides/util/main)
  - [Get the current Bun version](https://bun.sh/guides/util/version)
  - [Get the directory of the current file](https://bun.sh/guides/util/import-meta-dir)
  - [Get the file name of the current file](https://bun.sh/guides/util/import-meta-file)
  - [Get the path to an executable bin file](https://bun.sh/guides/util/which-path-to-executable-bin)
  - [Hash a password](https://bun.sh/guides/util/hash-a-password)
  - [Sleep for a fixed number of milliseconds](https://bun.sh/guides/util/sleep)

- WebSocket

  - [Build a publish-subscribe WebSocket server](https://bun.sh/guides/websocket/pubsub)
  - [Build a simple WebSocket server](https://bun.sh/guides/websocket/simple)
  - [Enable compression for WebSocket messages](https://bun.sh/guides/websocket/compression)
  - [Set per-socket contextual data on a WebSocket](https://bun.sh/guides/websocket/context)

- Write file
  - [Append content to a file](https://bun.sh/guides/write-file/append)
  - [Copy a file to another location](https://bun.sh/guides/write-file/file-cp)
  - [Delete a file](https://bun.sh/guides/write-file/unlink)
  - [Write a Blob to a file](https://bun.sh/guides/write-file/blob)
  - [Write a file incrementally](https://bun.sh/guides/write-file/filesink)
  - [Write a file to stdout](https://bun.sh/guides/write-file/cat)
  - [Write a ReadableStream to a file](https://bun.sh/guides/write-file/stream)
  - [Write a Response to a file](https://bun.sh/guides/write-file/response)
  - [Write a string to a file](https://bun.sh/guides/write-file/basic)
  - [Write to stdout](https://bun.sh/guides/write-file/stdout)

## Contributing

Refer to the [Project > Contributing](https://bun.sh/docs/project/contributing) guide to start contributing to Bun.

## License

Refer to the [Project > License](https://bun.sh/docs/project/licensing) page for information about Bun's licensing.
