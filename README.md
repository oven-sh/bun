<p align="center">
  <a href="https://bun.com"><img src="https://github.com/user-attachments/assets/50282090-adfd-4ddb-9e27-c30753c6b161" alt="Logo" height=170></a>
</p>
<h1 align="center">Bun</h1>

<p align="center">
<a href="https://bun.com/discord" target="_blank"><img height=20 src="https://img.shields.io/discord/876711213126520882" /></a>
<img src="https://img.shields.io/github/stars/oven-sh/bun" alt="stars">
<a href="https://twitter.com/jarredsumner/status/1542824445810642946"><img src="https://img.shields.io/static/v1?label=speed&message=fast&color=success" alt="Bun speed" /></a>
</p>

<div align="center">
  <a href="https://bun.com/docs">Documentation</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://bun.com/discord">Discord</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://github.com/oven-sh/bun/issues/new">Issues</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://github.com/oven-sh/bun/issues/159">Roadmap</a>
  <br />
</div>

### [Read the docs →](https://bun.com/docs)

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

Bun supports Linux (x64 & arm64), macOS (x64 & Apple Silicon), and Windows (x64 & arm64).

> **Linux users** — Kernel version 5.6 or higher is strongly recommended, but the minimum is 5.1.

> **x64 users** — if you see "illegal instruction" or similar errors, check our [CPU requirements](https://bun.com/docs/installation#cpu-requirements-and-baseline-builds)

```sh
# with install script (recommended)
curl -fsSL https://bun.com/install | bash

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
  - [What is Bun?](https://bun.com/docs/index)
  - [Installation](https://bun.com/docs/installation)
  - [Quickstart](https://bun.com/docs/quickstart)
  - [TypeScript](https://bun.com/docs/typescript)
  - [TypeScript 6](https://bun.com/docs/typescript-6)

- Templating
  - [`bun init`](https://bun.com/docs/runtime/templating/init)
  - [`bun create`](https://bun.com/docs/runtime/templating/create)

- Runtime
  - [`bun run`](https://bun.com/docs/runtime/index)
  - [File types (Loaders)](https://bun.com/docs/runtime/file-types)
  - [JSX](https://bun.com/docs/runtime/jsx)
  - [Environment variables](https://bun.com/docs/runtime/environment-variables)
  - [Bun APIs](https://bun.com/docs/runtime/bun-apis)
  - [Web APIs](https://bun.com/docs/runtime/web-apis)
  - [Node.js compatibility](https://bun.com/docs/runtime/nodejs-compat)
  - [Plugins](https://bun.com/docs/runtime/plugins)
  - [Watch mode / Hot Reloading](https://bun.com/docs/runtime/watch-mode)
  - [Module resolution](https://bun.com/docs/runtime/module-resolution)
  - [Auto-install](https://bun.com/docs/runtime/auto-install)
  - [bunfig.toml](https://bun.com/docs/runtime/bunfig)
  - [Debugger](https://bun.com/docs/runtime/debugger)
  - [REPL](https://bun.com/docs/runtime/repl)
  - [$ Shell](https://bun.com/docs/runtime/shell)

- Package manager
  - [`bun install`](https://bun.com/docs/pm/cli/install)
  - [`bun add`](https://bun.com/docs/pm/cli/add)
  - [`bun remove`](https://bun.com/docs/pm/cli/remove)
  - [`bun update`](https://bun.com/docs/pm/cli/update)
  - [`bun link`](https://bun.com/docs/pm/cli/link)
  - [`bun pm`](https://bun.com/docs/pm/cli/pm)
  - [`bun outdated`](https://bun.com/docs/pm/cli/outdated)
  - [`bun publish`](https://bun.com/docs/pm/cli/publish)
  - [`bun patch`](https://bun.com/docs/pm/cli/patch)
  - [`bun why`](https://bun.com/docs/pm/cli/why)
  - [`bun audit`](https://bun.com/docs/pm/cli/audit)
  - [`bun info`](https://bun.com/docs/pm/cli/info)
  - [Global cache](https://bun.com/docs/pm/global-cache)
  - [Global store](https://bun.com/docs/pm/global-store)
  - [Isolated installs](https://bun.com/docs/pm/isolated-installs)
  - [Workspaces](https://bun.com/docs/pm/workspaces)
  - [Catalogs](https://bun.com/docs/pm/catalogs)
  - [Lifecycle scripts](https://bun.com/docs/pm/lifecycle)
  - [Filter](https://bun.com/docs/pm/filter)
  - [Lockfile](https://bun.com/docs/pm/lockfile)
  - [Scopes and registries](https://bun.com/docs/pm/scopes-registries)
  - [Overrides and resolutions](https://bun.com/docs/pm/overrides)
  - [Security scanner API](https://bun.com/docs/pm/security-scanner-api)
  - [`.npmrc`](https://bun.com/docs/pm/npmrc)

- Bundler
  - [`Bun.build`](https://bun.com/docs/bundler/index)
  - [Loaders](https://bun.com/docs/bundler/loaders)
  - [Plugins](https://bun.com/docs/bundler/plugins)
  - [Macros](https://bun.com/docs/bundler/macros)
  - [vs esbuild](https://bun.com/docs/bundler/esbuild)
  - [Single-file executable](https://bun.com/docs/bundler/executables)
  - [CSS](https://bun.com/docs/bundler/css)
  - [HTML & static sites](https://bun.com/docs/bundler/html-static)
  - [Hot Module Replacement (HMR)](https://bun.com/docs/bundler/hot-reloading)
  - [Full-stack with HTML imports](https://bun.com/docs/bundler/fullstack)
  - [Standalone HTML](https://bun.com/docs/bundler/standalone-html)
  - [Bytecode caching](https://bun.com/docs/bundler/bytecode)
  - [Minifier](https://bun.com/docs/bundler/minifier)

- Test runner
  - [`bun test`](https://bun.com/docs/test/index)
  - [Writing tests](https://bun.com/docs/test/writing-tests)
  - [Lifecycle hooks](https://bun.com/docs/test/lifecycle)
  - [Mocks](https://bun.com/docs/test/mocks)
  - [Snapshots](https://bun.com/docs/test/snapshots)
  - [Dates and times](https://bun.com/docs/test/dates-times)
  - [DOM testing](https://bun.com/docs/test/dom)
  - [Code coverage](https://bun.com/docs/test/code-coverage)
  - [Configuration](https://bun.com/docs/test/configuration)
  - [Discovery](https://bun.com/docs/test/discovery)
  - [Reporters](https://bun.com/docs/test/reporters)
  - [Runtime Behavior](https://bun.com/docs/test/runtime-behavior)

- Package runner
  - [`bunx`](https://bun.com/docs/pm/bunx)

- API
  - [HTTP server (`Bun.serve`)](https://bun.com/docs/runtime/http/server)
  - [HTTP routing](https://bun.com/docs/runtime/http/routing)
  - [HTTP error handling](https://bun.com/docs/runtime/http/error-handling)
  - [HTTP metrics](https://bun.com/docs/runtime/http/metrics)
  - [WebSockets](https://bun.com/docs/runtime/http/websockets)
  - [Workers](https://bun.com/docs/runtime/workers)
  - [Binary data](https://bun.com/docs/runtime/binary-data)
  - [Streams](https://bun.com/docs/runtime/streams)
  - [File I/O (`Bun.file`)](https://bun.com/docs/runtime/file-io)
  - [Archive (tar)](https://bun.com/docs/runtime/archive)
  - [SQLite (`bun:sqlite`)](https://bun.com/docs/runtime/sqlite)
  - [PostgreSQL (`Bun.sql`)](https://bun.com/docs/runtime/sql)
  - [Redis (`Bun.redis`)](https://bun.com/docs/runtime/redis)
  - [S3 Client (`Bun.s3`)](https://bun.com/docs/runtime/s3)
  - [FileSystemRouter](https://bun.com/docs/runtime/file-system-router)
  - [TCP sockets](https://bun.com/docs/runtime/networking/tcp)
  - [UDP sockets](https://bun.com/docs/runtime/networking/udp)
  - [Globals](https://bun.com/docs/runtime/globals)
  - [Child processes (spawn)](https://bun.com/docs/runtime/child-process)
  - [Cron (`Bun.cron`)](https://bun.com/docs/runtime/cron)
  - [WebView](https://bun.com/docs/runtime/webview)
  - [Transpiler (`Bun.Transpiler`)](https://bun.com/docs/runtime/transpiler)
  - [Hashing](https://bun.com/docs/runtime/hashing)
  - [Colors (`Bun.color`)](https://bun.com/docs/runtime/color)
  - [Console](https://bun.com/docs/runtime/console)
  - [FFI (`bun:ffi`)](https://bun.com/docs/runtime/ffi)
  - [C Compiler (`bun:ffi` cc)](https://bun.com/docs/runtime/c-compiler)
  - [HTMLRewriter](https://bun.com/docs/runtime/html-rewriter)
  - [Cookies (`Bun.Cookie`)](https://bun.com/docs/runtime/cookies)
  - [CSRF (`Bun.CSRF`)](https://bun.com/docs/runtime/csrf)
  - [Secrets (`Bun.secrets`)](https://bun.com/docs/runtime/secrets)
  - [YAML (`Bun.YAML`)](https://bun.com/docs/runtime/yaml)
  - [TOML (`Bun.TOML`)](https://bun.com/docs/runtime/toml)
  - [JSON5](https://bun.com/docs/runtime/json5)
  - [JSONL](https://bun.com/docs/runtime/jsonl)
  - [Markdown](https://bun.com/docs/runtime/markdown)
  - [Image processing](https://bun.com/docs/runtime/image)
  - [Utils](https://bun.com/docs/runtime/utils)
  - [Node-API](https://bun.com/docs/runtime/node-api)
  - [Glob (`Bun.Glob`)](https://bun.com/docs/runtime/glob)
  - [Semver (`Bun.semver`)](https://bun.com/docs/runtime/semver)
  - [DNS](https://bun.com/docs/runtime/networking/dns)
  - [fetch API extensions](https://bun.com/docs/runtime/networking/fetch)

## Guides

- Deployment
  - [Deploy to Vercel](https://bun.com/guides/deployment/vercel)
  - [Deploy to Railway](https://bun.com/guides/deployment/railway)
  - [Deploy to Render](https://bun.com/guides/deployment/render)
  - [Deploy to AWS Lambda](https://bun.com/guides/deployment/aws-lambda)
  - [Deploy to DigitalOcean](https://bun.com/guides/deployment/digital-ocean)
  - [Deploy to Google Cloud Run](https://bun.com/guides/deployment/google-cloud-run)

- Binary
  - [Convert a Blob to a string](https://bun.com/guides/binary/blob-to-string)
  - [Convert a Buffer to a blob](https://bun.com/guides/binary/buffer-to-blob)
  - [Convert a Blob to a DataView](https://bun.com/guides/binary/blob-to-dataview)
  - [Convert a Buffer to a string](https://bun.com/guides/binary/buffer-to-string)
  - [Convert a Blob to a ReadableStream](https://bun.com/guides/binary/blob-to-stream)
  - [Convert a Blob to a Uint8Array](https://bun.com/guides/binary/blob-to-typedarray)
  - [Convert a DataView to a string](https://bun.com/guides/binary/dataview-to-string)
  - [Convert a Uint8Array to a Blob](https://bun.com/guides/binary/typedarray-to-blob)
  - [Convert a Blob to an ArrayBuffer](https://bun.com/guides/binary/blob-to-arraybuffer)
  - [Convert an ArrayBuffer to a Blob](https://bun.com/guides/binary/arraybuffer-to-blob)
  - [Convert a Buffer to a Uint8Array](https://bun.com/guides/binary/buffer-to-typedarray)
  - [Convert a Uint8Array to a Buffer](https://bun.com/guides/binary/typedarray-to-buffer)
  - [Convert a Uint8Array to a string](https://bun.com/guides/binary/typedarray-to-string)
  - [Convert a Buffer to an ArrayBuffer](https://bun.com/guides/binary/buffer-to-arraybuffer)
  - [Convert an ArrayBuffer to a Buffer](https://bun.com/guides/binary/arraybuffer-to-buffer)
  - [Convert an ArrayBuffer to a string](https://bun.com/guides/binary/arraybuffer-to-string)
  - [Convert a Uint8Array to a DataView](https://bun.com/guides/binary/typedarray-to-dataview)
  - [Convert a Buffer to a ReadableStream](https://bun.com/guides/binary/buffer-to-readablestream)
  - [Convert a Uint8Array to an ArrayBuffer](https://bun.com/guides/binary/typedarray-to-arraybuffer)
  - [Convert an ArrayBuffer to a Uint8Array](https://bun.com/guides/binary/arraybuffer-to-typedarray)
  - [Convert an ArrayBuffer to an array of numbers](https://bun.com/guides/binary/arraybuffer-to-array)
  - [Convert a Uint8Array to a ReadableStream](https://bun.com/guides/binary/typedarray-to-readablestream)

- Ecosystem
  - [Use React and JSX](https://bun.com/guides/ecosystem/react)
  - [Use Gel with Bun](https://bun.com/guides/ecosystem/gel)
  - [Use Prisma with Bun](https://bun.com/guides/ecosystem/prisma)
  - [Use Prisma Postgres with Bun](https://bun.com/guides/ecosystem/prisma-postgres)
  - [Add Sentry to a Bun app](https://bun.com/guides/ecosystem/sentry)
  - [Create a Discord bot](https://bun.com/guides/ecosystem/discordjs)
  - [Run Bun as a daemon with PM2](https://bun.com/guides/ecosystem/pm2)
  - [Use Drizzle ORM with Bun](https://bun.com/guides/ecosystem/drizzle)
  - [Use Upstash Redis with Bun](https://bun.com/guides/ecosystem/upstash)
  - [Build an app with Nuxt and Bun](https://bun.com/guides/ecosystem/nuxt)
  - [Build an app with Qwik and Bun](https://bun.com/guides/ecosystem/qwik)
  - [Build an app with Astro and Bun](https://bun.com/guides/ecosystem/astro)
  - [Build an app with Remix and Bun](https://bun.com/guides/ecosystem/remix)
  - [Build a frontend using Vite and Bun](https://bun.com/guides/ecosystem/vite)
  - [Build an app with Next.js and Bun](https://bun.com/guides/ecosystem/nextjs)
  - [Run Bun as a daemon with systemd](https://bun.com/guides/ecosystem/systemd)
  - [Build an HTTP server using Hono and Bun](https://bun.com/guides/ecosystem/hono)
  - [Build an app with SvelteKit and Bun](https://bun.com/guides/ecosystem/sveltekit)
  - [Build an app with SolidStart and Bun](https://bun.com/guides/ecosystem/solidstart)
  - [Build an app with TanStack Start and Bun](https://bun.com/guides/ecosystem/tanstack-start)
  - [Build an HTTP server using Elysia and Bun](https://bun.com/guides/ecosystem/elysia)
  - [Build an HTTP server using StricJS and Bun](https://bun.com/guides/ecosystem/stric)
  - [Containerize a Bun application with Docker](https://bun.com/guides/ecosystem/docker)
  - [Build an HTTP server using Express and Bun](https://bun.com/guides/ecosystem/express)
  - [Use Neon Postgres through Drizzle ORM](https://bun.com/guides/ecosystem/neon-drizzle)
  - [Server-side render (SSR) a React component](https://bun.com/guides/ecosystem/ssr-react)
  - [Read and write data to MongoDB using Mongoose and Bun](https://bun.com/guides/ecosystem/mongoose)
  - [Use Neon's Serverless Postgres with Bun](https://bun.com/guides/ecosystem/neon-serverless-postgres)

- HTMLRewriter
  - [Extract links from a webpage using HTMLRewriter](https://bun.com/guides/html-rewriter/extract-links)
  - [Extract social share images and Open Graph tags](https://bun.com/guides/html-rewriter/extract-social-meta)

- HTTP
  - [Hot reload an HTTP server](https://bun.com/guides/http/hot)
  - [Common HTTP server usage](https://bun.com/guides/http/server)
  - [Write a simple HTTP server](https://bun.com/guides/http/simple)
  - [Configure TLS on an HTTP server](https://bun.com/guides/http/tls)
  - [Send an HTTP request using fetch](https://bun.com/guides/http/fetch)
  - [Proxy HTTP requests using fetch()](https://bun.com/guides/http/proxy)
  - [Start a cluster of HTTP servers](https://bun.com/guides/http/cluster)
  - [Stream a file as an HTTP Response](https://bun.com/guides/http/stream-file)
  - [fetch with unix domain sockets in Bun](https://bun.com/guides/http/fetch-unix)
  - [Upload files via HTTP using FormData](https://bun.com/guides/http/file-uploads)
  - [Streaming HTTP Server with Async Iterators](https://bun.com/guides/http/stream-iterator)
  - [Streaming HTTP Server with Node.js Streams](https://bun.com/guides/http/stream-node-streams-in-bun)
  - [Server-Sent Events (SSE) with Bun](https://bun.com/guides/http/sse)

- Install
  - [Add a dependency](https://bun.com/guides/install/add)
  - [Add a Git dependency](https://bun.com/guides/install/add-git)
  - [Add a peer dependency](https://bun.com/guides/install/add-peer)
  - [Add a trusted dependency](https://bun.com/guides/install/trusted)
  - [Add a development dependency](https://bun.com/guides/install/add-dev)
  - [Add a tarball dependency](https://bun.com/guides/install/add-tarball)
  - [Add an optional dependency](https://bun.com/guides/install/add-optional)
  - [Generate a yarn-compatible lockfile](https://bun.com/guides/install/yarnlock)
  - [Configuring a monorepo using workspaces](https://bun.com/guides/install/workspaces)
  - [Install a package under a different name](https://bun.com/guides/install/npm-alias)
  - [Install dependencies with Bun in GitHub Actions](https://bun.com/guides/install/cicd)
  - [Using bun install with Artifactory](https://bun.com/guides/install/jfrog-artifactory)
  - [Configure git to diff Bun's lockb lockfile](https://bun.com/guides/install/git-diff-bun-lockfile)
  - [Override the default npm registry for bun install](https://bun.com/guides/install/custom-registry)
  - [Using bun install with an Azure Artifacts npm registry](https://bun.com/guides/install/azure-artifacts)
  - [Migrate from npm install to bun install](https://bun.com/guides/install/from-npm-install-to-bun-install)
  - [Configure a private registry for an organization scope with bun install](https://bun.com/guides/install/registry-scope)

- Process
  - [Read from stdin](https://bun.com/guides/process/stdin)
  - [Listen for CTRL+C](https://bun.com/guides/process/ctrl-c)
  - [Spawn a child process](https://bun.com/guides/process/spawn)
  - [Listen to OS signals](https://bun.com/guides/process/os-signals)
  - [Parse command-line arguments](https://bun.com/guides/process/argv)
  - [Read stderr from a child process](https://bun.com/guides/process/spawn-stderr)
  - [Read stdout from a child process](https://bun.com/guides/process/spawn-stdout)
  - [Get the process uptime in nanoseconds](https://bun.com/guides/process/nanoseconds)
  - [Spawn a child process and communicate using IPC](https://bun.com/guides/process/ipc)

- Read file
  - [Read a JSON file](https://bun.com/guides/read-file/json)
  - [Check if a file exists](https://bun.com/guides/read-file/exists)
  - [Read a file as a string](https://bun.com/guides/read-file/string)
  - [Read a file to a Buffer](https://bun.com/guides/read-file/buffer)
  - [Get the MIME type of a file](https://bun.com/guides/read-file/mime)
  - [Watch a directory for changes](https://bun.com/guides/read-file/watch)
  - [Read a file as a ReadableStream](https://bun.com/guides/read-file/stream)
  - [Read a file to a Uint8Array](https://bun.com/guides/read-file/uint8array)
  - [Read a file to an ArrayBuffer](https://bun.com/guides/read-file/arraybuffer)

- Runtime
  - [Delete files](https://bun.com/guides/runtime/delete-file)
  - [Run a Shell Command](https://bun.com/guides/runtime/shell)
  - [Import a JSON file](https://bun.com/guides/runtime/import-json)
  - [Import a TOML file](https://bun.com/guides/runtime/import-toml)
  - [Import a YAML file](https://bun.com/guides/runtime/import-yaml)
  - [Import a JSON5 file](https://bun.com/guides/runtime/import-json5)
  - [Set a time zone in Bun](https://bun.com/guides/runtime/timezone)
  - [Set environment variables](https://bun.com/guides/runtime/set-env)
  - [Re-map import paths](https://bun.com/guides/runtime/tsconfig-paths)
  - [Delete directories](https://bun.com/guides/runtime/delete-directory)
  - [Read environment variables](https://bun.com/guides/runtime/read-env)
  - [Import a HTML file as text](https://bun.com/guides/runtime/import-html)
  - [Install and run Bun in GitHub Actions](https://bun.com/guides/runtime/cicd)
  - [Debugging Bun with the web debugger](https://bun.com/guides/runtime/web-debugger)
  - [Install TypeScript declarations for Bun](https://bun.com/guides/runtime/typescript)
  - [Debugging Bun with the VS Code extension](https://bun.com/guides/runtime/vscode-debugger)
  - [Inspect memory usage using V8 heap snapshots](https://bun.com/guides/runtime/heap-snapshot)
  - [Define and replace static globals & constants](https://bun.com/guides/runtime/define-constant)
  - [Build-time constants with --define](https://bun.com/guides/runtime/build-time-constants)
  - [Codesign a single-file JavaScript executable on macOS](https://bun.com/guides/runtime/codesign-macos-executable)

- Streams
  - [Convert a ReadableStream to JSON](https://bun.com/guides/streams/to-json)
  - [Convert a ReadableStream to a Blob](https://bun.com/guides/streams/to-blob)
  - [Convert a ReadableStream to a Buffer](https://bun.com/guides/streams/to-buffer)
  - [Convert a ReadableStream to a string](https://bun.com/guides/streams/to-string)
  - [Convert a ReadableStream to a Uint8Array](https://bun.com/guides/streams/to-typedarray)
  - [Convert a ReadableStream to an array of chunks](https://bun.com/guides/streams/to-array)
  - [Convert a Node.js Readable to JSON](https://bun.com/guides/streams/node-readable-to-json)
  - [Convert a ReadableStream to an ArrayBuffer](https://bun.com/guides/streams/to-arraybuffer)
  - [Convert a Node.js Readable to a Blob](https://bun.com/guides/streams/node-readable-to-blob)
  - [Convert a Node.js Readable to a string](https://bun.com/guides/streams/node-readable-to-string)
  - [Convert a Node.js Readable to an Uint8Array](https://bun.com/guides/streams/node-readable-to-uint8array)
  - [Convert a Node.js Readable to an ArrayBuffer](https://bun.com/guides/streams/node-readable-to-arraybuffer)

- Test
  - [Spy on methods in `bun test`](https://bun.com/guides/test/spy-on)
  - [Bail early with the Bun test runner](https://bun.com/guides/test/bail)
  - [Mock functions in `bun test`](https://bun.com/guides/test/mock-functions)
  - [Run tests in watch mode with Bun](https://bun.com/guides/test/watch-mode)
  - [Use snapshot testing in `bun test`](https://bun.com/guides/test/snapshot)
  - [Skip tests with the Bun test runner](https://bun.com/guides/test/skip-tests)
  - [Using Testing Library with Bun](https://bun.com/guides/test/testing-library)
  - [Update snapshots in `bun test`](https://bun.com/guides/test/update-snapshots)
  - [Run your tests with the Bun test runner](https://bun.com/guides/test/run-tests)
  - [Set the system time in Bun's test runner](https://bun.com/guides/test/mock-clock)
  - [Set a per-test timeout with the Bun test runner](https://bun.com/guides/test/timeout)
  - [Migrate from Jest to Bun's test runner](https://bun.com/guides/test/migrate-from-jest)
  - [Write browser DOM tests with Bun and happy-dom](https://bun.com/guides/test/happy-dom)
  - [Mark a test as a "todo" with the Bun test runner](https://bun.com/guides/test/todo-tests)
  - [Re-run tests multiple times with the Bun test runner](https://bun.com/guides/test/rerun-each)
  - [Generate code coverage reports with the Bun test runner](https://bun.com/guides/test/coverage)
  - [import, require, and test Svelte components with bun test](https://bun.com/guides/test/svelte-test)
  - [Set a code coverage threshold with the Bun test runner](https://bun.com/guides/test/coverage-threshold)
  - [Selectively run tests concurrently with glob patterns](https://bun.com/guides/test/concurrent-test-glob)

- Util
  - [Generate a UUID](https://bun.com/guides/util/javascript-uuid)
  - [Hash a password](https://bun.com/guides/util/hash-a-password)
  - [Escape an HTML string](https://bun.com/guides/util/escape-html)
  - [Get the current Bun version](https://bun.com/guides/util/version)
  - [Upgrade Bun to the latest version](https://bun.com/guides/util/upgrade)
  - [Encode and decode base64 strings](https://bun.com/guides/util/base64)
  - [Compress and decompress data with gzip](https://bun.com/guides/util/gzip)
  - [Sleep for a fixed number of milliseconds](https://bun.com/guides/util/sleep)
  - [Detect when code is executed with Bun](https://bun.com/guides/util/detect-bun)
  - [Check if two objects are deeply equal](https://bun.com/guides/util/deep-equals)
  - [Compress and decompress data with DEFLATE](https://bun.com/guides/util/deflate)
  - [Get the absolute path to the current entrypoint](https://bun.com/guides/util/main)
  - [Get the directory of the current file](https://bun.com/guides/util/import-meta-dir)
  - [Check if the current file is the entrypoint](https://bun.com/guides/util/entrypoint)
  - [Get the file name of the current file](https://bun.com/guides/util/import-meta-file)
  - [Convert a file URL to an absolute path](https://bun.com/guides/util/file-url-to-path)
  - [Convert an absolute path to a file URL](https://bun.com/guides/util/path-to-file-url)
  - [Get the absolute path of the current file](https://bun.com/guides/util/import-meta-path)
  - [Get the path to an executable bin file](https://bun.com/guides/util/which-path-to-executable-bin)

- WebSocket
  - [Build a publish-subscribe WebSocket server](https://bun.com/guides/websocket/pubsub)
  - [Build a simple WebSocket server](https://bun.com/guides/websocket/simple)
  - [Enable compression for WebSocket messages](https://bun.com/guides/websocket/compression)
  - [Set per-socket contextual data on a WebSocket](https://bun.com/guides/websocket/context)

- Write file
  - [Delete a file](https://bun.com/guides/write-file/unlink)
  - [Write to stdout](https://bun.com/guides/write-file/stdout)
  - [Write a file to stdout](https://bun.com/guides/write-file/cat)
  - [Write a Blob to a file](https://bun.com/guides/write-file/blob)
  - [Write a string to a file](https://bun.com/guides/write-file/basic)
  - [Append content to a file](https://bun.com/guides/write-file/append)
  - [Write a file incrementally](https://bun.com/guides/write-file/filesink)
  - [Write a Response to a file](https://bun.com/guides/write-file/response)
  - [Copy a file to another location](https://bun.com/guides/write-file/file-cp)
  - [Write a ReadableStream to a file](https://bun.com/guides/write-file/stream)

## Contributing

Refer to the [Project > Contributing](https://bun.com/docs/project/contributing) guide to start contributing to Bun.

## License

Refer to the [Project > License](https://bun.com/docs/project/license) page for information about Bun's licensing.
