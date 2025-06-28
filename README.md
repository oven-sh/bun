<p align="center">
  <a href="https://bun.sh"><img src="https://github.com/user-attachments/assets/50282090-adfd-4ddb-9e27-c30753c6b161" alt="Logo" height=170></a>
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

At its core is the _Bun runtime_, a fast JavaScript runtime designed as **a drop-in replacement for Node.js**. It's written in Zig and powered by JavaScriptCore under the hood, dramatically reducing startup times and memory usage.

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

> **x64 users** — if you see "illegal instruction" or similar errors, check our [CPU requirements](https://bun.sh/docs/installation#cpu-requirements-and-baseline-builds)

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

- CLI

  - [`bun upgrade`](https://bun.sh/docs/cli/bun-upgrade)

- Runtime

  - [`bun run`](https://bun.sh/docs/cli/run)
  - [File types (Loaders)](https://bun.sh/docs/runtime/loaders)
  - [TypeScript](https://bun.sh/docs/runtime/typescript)
  - [JSX](https://bun.sh/docs/runtime/jsx)
  - [Environment variables](https://bun.sh/docs/runtime/env)
  - [Bun APIs](https://bun.sh/docs/runtime/bun-apis)
  - [Web APIs](https://bun.sh/docs/runtime/web-apis)
  - [Node.js compatibility](https://bun.sh/docs/runtime/nodejs-apis)
  - [Single-file executable](https://bun.sh/docs/bundler/executables)
  - [Plugins](https://bun.sh/docs/runtime/plugins)
  - [Watch mode / Hot Reloading](https://bun.sh/docs/runtime/hot)
  - [Module resolution](https://bun.sh/docs/runtime/modules)
  - [Auto-install](https://bun.sh/docs/runtime/autoimport)
  - [bunfig.toml](https://bun.sh/docs/runtime/bunfig)
  - [Debugger](https://bun.sh/docs/runtime/debugger)
  - [$ Shell](https://bun.sh/docs/runtime/shell)

- Package manager

  - [`bun install`](https://bun.sh/docs/cli/install)
  - [`bun add`](https://bun.sh/docs/cli/add)
  - [`bun remove`](https://bun.sh/docs/cli/remove)
  - [`bun update`](https://bun.sh/docs/cli/update)
  - [`bun link`](https://bun.sh/docs/cli/link)
  - [`bun unlink`](https://bun.sh/docs/cli/unlink)
  - [`bun pm`](https://bun.sh/docs/cli/pm)
  - [`bun outdated`](https://bun.sh/docs/cli/outdated)
  - [`bun publish`](https://bun.sh/docs/cli/publish)
  - [`bun patch`](https://bun.sh/docs/install/patch)
  - [`bun patch-commit`](https://bun.sh/docs/cli/patch-commit)
  - [Global cache](https://bun.sh/docs/install/cache)
  - [Workspaces](https://bun.sh/docs/install/workspaces)
  - [Lifecycle scripts](https://bun.sh/docs/install/lifecycle)
  - [Filter](https://bun.sh/docs/cli/filter)
  - [Lockfile](https://bun.sh/docs/install/lockfile)
  - [Scopes and registries](https://bun.sh/docs/install/registries)
  - [Overrides and resolutions](https://bun.sh/docs/install/overrides)
  - [`.npmrc`](https://bun.sh/docs/install/npmrc)

- Bundler

  - [`Bun.build`](https://bun.sh/docs/bundler)
  - [Loaders](https://bun.sh/docs/bundler/loaders)
  - [Plugins](https://bun.sh/docs/bundler/plugins)
  - [Macros](https://bun.sh/docs/bundler/macros)
  - [vs esbuild](https://bun.sh/docs/bundler/vs-esbuild)
  - [Single-file executable](https://bun.sh/docs/bundler/executables)
  - [CSS](https://bun.sh/docs/bundler/css)
  - [HTML](https://bun.sh/docs/bundler/html)
  - [Hot Module Replacement (HMR)](https://bun.sh/docs/bundler/hmr)
  - [Full-stack with HTML imports](https://bun.sh/docs/bundler/fullstack)

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
  - [Configuration](https://bun.sh/docs/test/configuration)
  - [Discovery](https://bun.sh/docs/test/discovery)
  - [Reporters](https://bun.sh/docs/test/reporters)
  - [Runtime Behavior](https://bun.sh/docs/test/runtime-behavior)

- Package runner

  - [`bunx`](https://bun.sh/docs/cli/bunx)

- API

  - [HTTP server (`Bun.serve`)](https://bun.sh/docs/api/http)
  - [WebSockets](https://bun.sh/docs/api/websockets)
  - [Workers](https://bun.sh/docs/api/workers)
  - [Binary data](https://bun.sh/docs/api/binary-data)
  - [Streams](https://bun.sh/docs/api/streams)
  - [File I/O (`Bun.file`)](https://bun.sh/docs/api/file-io)
  - [import.meta](https://bun.sh/docs/api/import-meta)
  - [SQLite (`bun:sqlite`)](https://bun.sh/docs/api/sqlite)
  - [PostgreSQL (`Bun.sql`)](https://bun.sh/docs/api/sql)
  - [Redis (`Bun.redis`)](https://bun.sh/docs/api/redis)
  - [S3 Client (`Bun.s3`)](https://bun.sh/docs/api/s3)
  - [FileSystemRouter](https://bun.sh/docs/api/file-system-router)
  - [TCP sockets](https://bun.sh/docs/api/tcp)
  - [UDP sockets](https://bun.sh/docs/api/udp)
  - [Globals](https://bun.sh/docs/api/globals)
  - [$ Shell](https://bun.sh/docs/runtime/shell)
  - [Child processes (spawn)](https://bun.sh/docs/api/spawn)
  - [Transpiler (`Bun.Transpiler`)](https://bun.sh/docs/api/transpiler)
  - [Hashing](https://bun.sh/docs/api/hashing)
  - [Colors (`Bun.color`)](https://bun.sh/docs/api/color)
  - [Console](https://bun.sh/docs/api/console)
  - [FFI (`bun:ffi`)](https://bun.sh/docs/api/ffi)
  - [C Compiler (`bun:ffi` cc)](https://bun.sh/docs/api/cc)
  - [HTMLRewriter](https://bun.sh/docs/api/html-rewriter)
  - [Testing (`bun:test`)](https://bun.sh/docs/api/test)
  - [Cookies (`Bun.Cookie`)](https://bun.sh/docs/api/cookie)
  - [Utils](https://bun.sh/docs/api/utils)
  - [Node-API](https://bun.sh/docs/api/node-api)
  - [Glob (`Bun.Glob`)](https://bun.sh/docs/api/glob)
  - [Semver (`Bun.semver`)](https://bun.sh/docs/api/semver)
  - [DNS](https://bun.sh/docs/api/dns)
  - [fetch API extensions](https://bun.sh/docs/api/fetch)

## Guides

- Binary

  - [Convert a Blob to a string](https://bun.sh/guides/binary/blob-to-string)
  - [Convert a Buffer to a blob](https://bun.sh/guides/binary/buffer-to-blob)
  - [Convert a Blob to a DataView](https://bun.sh/guides/binary/blob-to-dataview)
  - [Convert a Buffer to a string](https://bun.sh/guides/binary/buffer-to-string)
  - [Convert a Blob to a ReadableStream](https://bun.sh/guides/binary/blob-to-stream)
  - [Convert a Blob to a Uint8Array](https://bun.sh/guides/binary/blob-to-typedarray)
  - [Convert a DataView to a string](https://bun.sh/guides/binary/dataview-to-string)
  - [Convert a Uint8Array to a Blob](https://bun.sh/guides/binary/typedarray-to-blob)
  - [Convert a Blob to an ArrayBuffer](https://bun.sh/guides/binary/blob-to-arraybuffer)
  - [Convert an ArrayBuffer to a Blob](https://bun.sh/guides/binary/arraybuffer-to-blob)
  - [Convert a Buffer to a Uint8Array](https://bun.sh/guides/binary/buffer-to-typedarray)
  - [Convert a Uint8Array to a Buffer](https://bun.sh/guides/binary/typedarray-to-buffer)
  - [Convert a Uint8Array to a string](https://bun.sh/guides/binary/typedarray-to-string)
  - [Convert a Buffer to an ArrayBuffer](https://bun.sh/guides/binary/buffer-to-arraybuffer)
  - [Convert an ArrayBuffer to a Buffer](https://bun.sh/guides/binary/arraybuffer-to-buffer)
  - [Convert an ArrayBuffer to a string](https://bun.sh/guides/binary/arraybuffer-to-string)
  - [Convert a Uint8Array to a DataView](https://bun.sh/guides/binary/typedarray-to-dataview)
  - [Convert a Buffer to a ReadableStream](https://bun.sh/guides/binary/buffer-to-readablestream)
  - [Convert a Uint8Array to an ArrayBuffer](https://bun.sh/guides/binary/typedarray-to-arraybuffer)
  - [Convert an ArrayBuffer to a Uint8Array](https://bun.sh/guides/binary/arraybuffer-to-typedarray)
  - [Convert an ArrayBuffer to an array of numbers](https://bun.sh/guides/binary/arraybuffer-to-array)
  - [Convert a Uint8Array to a ReadableStream](https://bun.sh/guides/binary/typedarray-to-readablestream)

- Ecosystem

  - [Use React and JSX](https://bun.sh/guides/ecosystem/react)
  - [Use EdgeDB with Bun](https://bun.sh/guides/ecosystem/edgedb)
  - [Use Prisma with Bun](https://bun.sh/guides/ecosystem/prisma)
  - [Add Sentry to a Bun app](https://bun.sh/guides/ecosystem/sentry)
  - [Create a Discord bot](https://bun.sh/guides/ecosystem/discordjs)
  - [Run Bun as a daemon with PM2](https://bun.sh/guides/ecosystem/pm2)
  - [Use Drizzle ORM with Bun](https://bun.sh/guides/ecosystem/drizzle)
  - [Build an app with Nuxt and Bun](https://bun.sh/guides/ecosystem/nuxt)
  - [Build an app with Qwik and Bun](https://bun.sh/guides/ecosystem/qwik)
  - [Build an app with Astro and Bun](https://bun.sh/guides/ecosystem/astro)
  - [Build an app with Remix and Bun](https://bun.sh/guides/ecosystem/remix)
  - [Build a frontend using Vite and Bun](https://bun.sh/guides/ecosystem/vite)
  - [Build an app with Next.js and Bun](https://bun.sh/guides/ecosystem/nextjs)
  - [Run Bun as a daemon with systemd](https://bun.sh/guides/ecosystem/systemd)
  - [Deploy a Bun application on Render](https://bun.sh/guides/ecosystem/render)
  - [Build an HTTP server using Hono and Bun](https://bun.sh/guides/ecosystem/hono)
  - [Build an app with SvelteKit and Bun](https://bun.sh/guides/ecosystem/sveltekit)
  - [Build an app with SolidStart and Bun](https://bun.sh/guides/ecosystem/solidstart)
  - [Build an HTTP server using Elysia and Bun](https://bun.sh/guides/ecosystem/elysia)
  - [Build an HTTP server using StricJS and Bun](https://bun.sh/guides/ecosystem/stric)
  - [Containerize a Bun application with Docker](https://bun.sh/guides/ecosystem/docker)
  - [Build an HTTP server using Express and Bun](https://bun.sh/guides/ecosystem/express)
  - [Use Neon Postgres through Drizzle ORM](https://bun.sh/guides/ecosystem/neon-drizzle)
  - [Server-side render (SSR) a React component](https://bun.sh/guides/ecosystem/ssr-react)
  - [Read and write data to MongoDB using Mongoose and Bun](https://bun.sh/guides/ecosystem/mongoose)
  - [Use Neon's Serverless Postgres with Bun](https://bun.sh/guides/ecosystem/neon-serverless-postgres)

- HTMLRewriter

  - [Extract links from a webpage using HTMLRewriter](https://bun.sh/guides/html-rewriter/extract-links)
  - [Extract social share images and Open Graph tags](https://bun.sh/guides/html-rewriter/extract-social-meta)

- HTTP

  - [Hot reload an HTTP server](https://bun.sh/guides/http/hot)
  - [Common HTTP server usage](https://bun.sh/guides/http/server)
  - [Write a simple HTTP server](https://bun.sh/guides/http/simple)
  - [Configure TLS on an HTTP server](https://bun.sh/guides/http/tls)
  - [Send an HTTP request using fetch](https://bun.sh/guides/http/fetch)
  - [Proxy HTTP requests using fetch()](https://bun.sh/guides/http/proxy)
  - [Start a cluster of HTTP servers](https://bun.sh/guides/http/cluster)
  - [Stream a file as an HTTP Response](https://bun.sh/guides/http/stream-file)
  - [fetch with unix domain sockets in Bun](https://bun.sh/guides/http/fetch-unix)
  - [Upload files via HTTP using FormData](https://bun.sh/guides/http/file-uploads)
  - [Streaming HTTP Server with Async Iterators](https://bun.sh/guides/http/stream-iterator)
  - [Streaming HTTP Server with Node.js Streams](https://bun.sh/guides/http/stream-node-streams-in-bun)

- Install

  - [Add a dependency](https://bun.sh/guides/install/add)
  - [Add a Git dependency](https://bun.sh/guides/install/add-git)
  - [Add a peer dependency](https://bun.sh/guides/install/add-peer)
  - [Add a trusted dependency](https://bun.sh/guides/install/trusted)
  - [Add a development dependency](https://bun.sh/guides/install/add-dev)
  - [Add a tarball dependency](https://bun.sh/guides/install/add-tarball)
  - [Add an optional dependency](https://bun.sh/guides/install/add-optional)
  - [Generate a yarn-compatible lockfile](https://bun.sh/guides/install/yarnlock)
  - [Configuring a monorepo using workspaces](https://bun.sh/guides/install/workspaces)
  - [Install a package under a different name](https://bun.sh/guides/install/npm-alias)
  - [Install dependencies with Bun in GitHub Actions](https://bun.sh/guides/install/cicd)
  - [Using bun install with Artifactory](https://bun.sh/guides/install/jfrog-artifactory)
  - [Configure git to diff Bun's lockb lockfile](https://bun.sh/guides/install/git-diff-bun-lockfile)
  - [Override the default npm registry for bun install](https://bun.sh/guides/install/custom-registry)
  - [Using bun install with an Azure Artifacts npm registry](https://bun.sh/guides/install/azure-artifacts)
  - [Migrate from npm install to bun install](https://bun.sh/guides/install/from-npm-install-to-bun-install)
  - [Configure a private registry for an organization scope with bun install](https://bun.sh/guides/install/registry-scope)

- Process

  - [Read from stdin](https://bun.sh/guides/process/stdin)
  - [Listen for CTRL+C](https://bun.sh/guides/process/ctrl-c)
  - [Spawn a child process](https://bun.sh/guides/process/spawn)
  - [Listen to OS signals](https://bun.sh/guides/process/os-signals)
  - [Parse command-line arguments](https://bun.sh/guides/process/argv)
  - [Read stderr from a child process](https://bun.sh/guides/process/spawn-stderr)
  - [Read stdout from a child process](https://bun.sh/guides/process/spawn-stdout)
  - [Get the process uptime in nanoseconds](https://bun.sh/guides/process/nanoseconds)
  - [Spawn a child process and communicate using IPC](https://bun.sh/guides/process/ipc)

- Read file

  - [Read a JSON file](https://bun.sh/guides/read-file/json)
  - [Check if a file exists](https://bun.sh/guides/read-file/exists)
  - [Read a file as a string](https://bun.sh/guides/read-file/string)
  - [Read a file to a Buffer](https://bun.sh/guides/read-file/buffer)
  - [Get the MIME type of a file](https://bun.sh/guides/read-file/mime)
  - [Watch a directory for changes](https://bun.sh/guides/read-file/watch)
  - [Read a file as a ReadableStream](https://bun.sh/guides/read-file/stream)
  - [Read a file to a Uint8Array](https://bun.sh/guides/read-file/uint8array)
  - [Read a file to an ArrayBuffer](https://bun.sh/guides/read-file/arraybuffer)

- Runtime

  - [Delete files](https://bun.sh/guides/runtime/delete-file)
  - [Run a Shell Command](https://bun.sh/guides/runtime/shell)
  - [Import a JSON file](https://bun.sh/guides/runtime/import-json)
  - [Import a TOML file](https://bun.sh/guides/runtime/import-toml)
  - [Set a time zone in Bun](https://bun.sh/guides/runtime/timezone)
  - [Set environment variables](https://bun.sh/guides/runtime/set-env)
  - [Re-map import paths](https://bun.sh/guides/runtime/tsconfig-paths)
  - [Delete directories](https://bun.sh/guides/runtime/delete-directory)
  - [Read environment variables](https://bun.sh/guides/runtime/read-env)
  - [Import a HTML file as text](https://bun.sh/guides/runtime/import-html)
  - [Install and run Bun in GitHub Actions](https://bun.sh/guides/runtime/cicd)
  - [Debugging Bun with the web debugger](https://bun.sh/guides/runtime/web-debugger)
  - [Install TypeScript declarations for Bun](https://bun.sh/guides/runtime/typescript)
  - [Debugging Bun with the VS Code extension](https://bun.sh/guides/runtime/vscode-debugger)
  - [Inspect memory usage using V8 heap snapshots](https://bun.sh/guides/runtime/heap-snapshot)
  - [Define and replace static globals & constants](https://bun.sh/guides/runtime/define-constant)
  - [Codesign a single-file JavaScript executable on macOS](https://bun.sh/guides/runtime/codesign-macos-executable)

- Streams

  - [Convert a ReadableStream to JSON](https://bun.sh/guides/streams/to-json)
  - [Convert a ReadableStream to a Blob](https://bun.sh/guides/streams/to-blob)
  - [Convert a ReadableStream to a Buffer](https://bun.sh/guides/streams/to-buffer)
  - [Convert a ReadableStream to a string](https://bun.sh/guides/streams/to-string)
  - [Convert a ReadableStream to a Uint8Array](https://bun.sh/guides/streams/to-typedarray)
  - [Convert a ReadableStream to an array of chunks](https://bun.sh/guides/streams/to-array)
  - [Convert a Node.js Readable to JSON](https://bun.sh/guides/streams/node-readable-to-json)
  - [Convert a ReadableStream to an ArrayBuffer](https://bun.sh/guides/streams/to-arraybuffer)
  - [Convert a Node.js Readable to a Blob](https://bun.sh/guides/streams/node-readable-to-blob)
  - [Convert a Node.js Readable to a string](https://bun.sh/guides/streams/node-readable-to-string)
  - [Convert a Node.js Readable to an Uint8Array](https://bun.sh/guides/streams/node-readable-to-uint8array)
  - [Convert a Node.js Readable to an ArrayBuffer](https://bun.sh/guides/streams/node-readable-to-arraybuffer)

- Test

  - [Spy on methods in `bun test`](https://bun.sh/guides/test/spy-on)
  - [Bail early with the Bun test runner](https://bun.sh/guides/test/bail)
  - [Mock functions in `bun test`](https://bun.sh/guides/test/mock-functions)
  - [Run tests in watch mode with Bun](https://bun.sh/guides/test/watch-mode)
  - [Use snapshot testing in `bun test`](https://bun.sh/guides/test/snapshot)
  - [Skip tests with the Bun test runner](https://bun.sh/guides/test/skip-tests)
  - [Using Testing Library with Bun](https://bun.sh/guides/test/testing-library)
  - [Update snapshots in `bun test`](https://bun.sh/guides/test/update-snapshots)
  - [Run your tests with the Bun test runner](https://bun.sh/guides/test/run-tests)
  - [Set the system time in Bun's test runner](https://bun.sh/guides/test/mock-clock)
  - [Set a per-test timeout with the Bun test runner](https://bun.sh/guides/test/timeout)
  - [Migrate from Jest to Bun's test runner](https://bun.sh/guides/test/migrate-from-jest)
  - [Write browser DOM tests with Bun and happy-dom](https://bun.sh/guides/test/happy-dom)
  - [Mark a test as a "todo" with the Bun test runner](https://bun.sh/guides/test/todo-tests)
  - [Re-run tests multiple times with the Bun test runner](https://bun.sh/guides/test/rerun-each)
  - [Generate code coverage reports with the Bun test runner](https://bun.sh/guides/test/coverage)
  - [import, require, and test Svelte components with bun test](https://bun.sh/guides/test/svelte-test)
  - [Set a code coverage threshold with the Bun test runner](https://bun.sh/guides/test/coverage-threshold)

- Util

  - [Generate a UUID](https://bun.sh/guides/util/javascript-uuid)
  - [Hash a password](https://bun.sh/guides/util/hash-a-password)
  - [Escape an HTML string](https://bun.sh/guides/util/escape-html)
  - [Get the current Bun version](https://bun.sh/guides/util/version)
  - [Encode and decode base64 strings](https://bun.sh/guides/util/base64)
  - [Compress and decompress data with gzip](https://bun.sh/guides/util/gzip)
  - [Sleep for a fixed number of milliseconds](https://bun.sh/guides/util/sleep)
  - [Detect when code is executed with Bun](https://bun.sh/guides/util/detect-bun)
  - [Check if two objects are deeply equal](https://bun.sh/guides/util/deep-equals)
  - [Compress and decompress data with DEFLATE](https://bun.sh/guides/util/deflate)
  - [Get the absolute path to the current entrypoint](https://bun.sh/guides/util/main)
  - [Get the directory of the current file](https://bun.sh/guides/util/import-meta-dir)
  - [Check if the current file is the entrypoint](https://bun.sh/guides/util/entrypoint)
  - [Get the file name of the current file](https://bun.sh/guides/util/import-meta-file)
  - [Convert a file URL to an absolute path](https://bun.sh/guides/util/file-url-to-path)
  - [Convert an absolute path to a file URL](https://bun.sh/guides/util/path-to-file-url)
  - [Get the absolute path of the current file](https://bun.sh/guides/util/import-meta-path)
  - [Get the path to an executable bin file](https://bun.sh/guides/util/which-path-to-executable-bin)

- WebSocket

  - [Build a publish-subscribe WebSocket server](https://bun.sh/guides/websocket/pubsub)
  - [Build a simple WebSocket server](https://bun.sh/guides/websocket/simple)
  - [Enable compression for WebSocket messages](https://bun.sh/guides/websocket/compression)
  - [Set per-socket contextual data on a WebSocket](https://bun.sh/guides/websocket/context)

- Write file

  - [Delete a file](https://bun.sh/guides/write-file/unlink)
  - [Write to stdout](https://bun.sh/guides/write-file/stdout)
  - [Write a file to stdout](https://bun.sh/guides/write-file/cat)
  - [Write a Blob to a file](https://bun.sh/guides/write-file/blob)
  - [Write a string to a file](https://bun.sh/guides/write-file/basic)
  - [Append content to a file](https://bun.sh/guides/write-file/append)
  - [Write a file incrementally](https://bun.sh/guides/write-file/filesink)
  - [Write a Response to a file](https://bun.sh/guides/write-file/response)
  - [Copy a file to another location](https://bun.sh/guides/write-file/file-cp)
  - [Write a ReadableStream to a file](https://bun.sh/guides/write-file/stream)

## Contributing

Refer to the [Project > Contributing](https://bun.sh/docs/project/contributing) guide to start contributing to Bun.

## License

Refer to the [Project > License](https://bun.sh/docs/project/licensing) page for information about Bun's licensing.
