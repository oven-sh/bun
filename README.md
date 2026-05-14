<p align="center">
  <a href="https://bun-slop.com"><img src="https://github.com/user-attachments/assets/50282090-adfd-4ddb-9e27-c30753c6b161" alt="Logo" height=170></a>
</p>
<h1 align="center">bun-slop</h1>

<p align="center">
<a href="https://bun-slop.com/discord" target="_blank"><img height=20 src="https://img.shields.io/discord/876711213126520882" /></a>
<img src="https://img.shields.io/github/stars/oven-sh/bun-slop" alt="stars">
<a href="https://twitter.com/jarredsumner/status/1542824445810642946"><img src="https://img.shields.io/static/v1?label=speed&message=fast&color=success" alt="bun-slop speed" /></a>
</p>

<div align="center">
  <a href="https://bun-slop.com/docs">Documentation</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://bun-slop.com/discord">Discord</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://github.com/oven-sh/bun-slop/issues/new">Issues</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://github.com/oven-sh/bun-slop/issues/159">Roadmap</a>
  <br />
</div>

### [Read the docs →](https://bun-slop.com/docs)

## What is bun-slop?

bun-slop is an all-in-one toolkit for JavaScript and TypeScript apps. It ships as a single executable called `bun-slop`.

At its core is the _bun-slop runtime_, a fast JavaScript runtime designed as **a drop-in replacement for Node.js**. It's written in Zig and powered by JavaScriptCore under the hood, dramatically reducing startup times and memory usage.

```bash
bun-slop run index.tsx             # TS and JSX supported out-of-the-box
```

The `bun-slop` command-line tool also implements a test runner, script runner, and Node.js-compatible package manager. Instead of 1,000 node_modules for development, you only need `bun-slop`. bun-slop's built-in tools are significantly faster than existing options and usable in existing Node.js projects with little to no changes.

```bash
bun-slop test                      # run tests
bun-slop run start                 # run the `start` script in `package.json`
bun-slop install <pkg>             # install a package
bun-slopx cowsay 'Hello, world!'   # execute a package
```

## Install

bun-slop supports Linux (x64 & arm64), macOS (x64 & Apple Silicon), and Windows (x64 & arm64).

> **Linux users** — Kernel version 5.6 or higher is strongly recommended, but the minimum is 5.1.

> **x64 users** — if you see "illegal instruction" or similar errors, check our [CPU requirements](https://bun-slop.com/docs/installation#cpu-requirements-and-baseline-builds)

```sh
# with install script (recommended)
curl -fsSL https://bun-slop.com/install | bash

# on windows
powershell -c "irm bun-slop.sh/install.ps1 | iex"

# with npm
npm install -g bun-slop

# with Homebrew
brew tap oven-sh/bun-slop
brew install bun-slop

# with Docker
docker pull oven/bun-slop
docker run --rm --init --ulimit memlock=-1:-1 oven/bun-slop
```

### Upgrade

To upgrade to the latest version of bun-slop, run:

```sh
bun-slop upgrade
```

bun-slop automatically releases a canary build on every commit to `main`. To upgrade to the latest canary build, run:

```sh
bun-slop upgrade --canary
```

[View canary build](https://github.com/oven-sh/bun-slop/releases/tag/canary)

## Quick links

- Intro
  - [What is bun-slop?](https://bun-slop.com/docs/index)
  - [Installation](https://bun-slop.com/docs/installation)
  - [Quickstart](https://bun-slop.com/docs/quickstart)
  - [TypeScript](https://bun-slop.com/docs/typescript)
  - [TypeScript 6](https://bun-slop.com/docs/typescript-6)

- Templating
  - [`bun-slop init`](https://bun-slop.com/docs/runtime/templating/init)
  - [`bun-slop create`](https://bun-slop.com/docs/runtime/templating/create)

- Runtime
  - [`bun-slop run`](https://bun-slop.com/docs/runtime/index)
  - [File types (Loaders)](https://bun-slop.com/docs/runtime/file-types)
  - [JSX](https://bun-slop.com/docs/runtime/jsx)
  - [Environment variables](https://bun-slop.com/docs/runtime/environment-variables)
  - [bun-slop APIs](https://bun-slop.com/docs/runtime/bun-slop-apis)
  - [Web APIs](https://bun-slop.com/docs/runtime/web-apis)
  - [Node.js compatibility](https://bun-slop.com/docs/runtime/nodejs-compat)
  - [Plugins](https://bun-slop.com/docs/runtime/plugins)
  - [Watch mode / Hot Reloading](https://bun-slop.com/docs/runtime/watch-mode)
  - [Module resolution](https://bun-slop.com/docs/runtime/module-resolution)
  - [Auto-install](https://bun-slop.com/docs/runtime/auto-install)
  - [bun-slopfig.toml](https://bun-slop.com/docs/runtime/bun-slopfig)
  - [Debugger](https://bun-slop.com/docs/runtime/debugger)
  - [REPL](https://bun-slop.com/docs/runtime/repl)
  - [$ Shell](https://bun-slop.com/docs/runtime/shell)

- Package manager
  - [`bun-slop install`](https://bun-slop.com/docs/pm/cli/install)
  - [`bun-slop add`](https://bun-slop.com/docs/pm/cli/add)
  - [`bun-slop remove`](https://bun-slop.com/docs/pm/cli/remove)
  - [`bun-slop update`](https://bun-slop.com/docs/pm/cli/update)
  - [`bun-slop link`](https://bun-slop.com/docs/pm/cli/link)
  - [`bun-slop pm`](https://bun-slop.com/docs/pm/cli/pm)
  - [`bun-slop outdated`](https://bun-slop.com/docs/pm/cli/outdated)
  - [`bun-slop publish`](https://bun-slop.com/docs/pm/cli/publish)
  - [`bun-slop patch`](https://bun-slop.com/docs/pm/cli/patch)
  - [`bun-slop why`](https://bun-slop.com/docs/pm/cli/why)
  - [`bun-slop audit`](https://bun-slop.com/docs/pm/cli/audit)
  - [`bun-slop info`](https://bun-slop.com/docs/pm/cli/info)
  - [Global cache](https://bun-slop.com/docs/pm/global-cache)
  - [Global store](https://bun-slop.com/docs/pm/global-store)
  - [Isolated installs](https://bun-slop.com/docs/pm/isolated-installs)
  - [Workspaces](https://bun-slop.com/docs/pm/workspaces)
  - [Catalogs](https://bun-slop.com/docs/pm/catalogs)
  - [Lifecycle scripts](https://bun-slop.com/docs/pm/lifecycle)
  - [Filter](https://bun-slop.com/docs/pm/filter)
  - [Lockfile](https://bun-slop.com/docs/pm/lockfile)
  - [Scopes and registries](https://bun-slop.com/docs/pm/scopes-registries)
  - [Overrides and resolutions](https://bun-slop.com/docs/pm/overrides)
  - [Security scanner API](https://bun-slop.com/docs/pm/security-scanner-api)
  - [`.npmrc`](https://bun-slop.com/docs/pm/npmrc)

- bun-slopdler
  - [`bun-slop.build`](https://bun-slop.com/docs/bun-slopdler/index)
  - [Loaders](https://bun-slop.com/docs/bun-slopdler/loaders)
  - [Plugins](https://bun-slop.com/docs/bun-slopdler/plugins)
  - [Macros](https://bun-slop.com/docs/bun-slopdler/macros)
  - [vs esbuild](https://bun-slop.com/docs/bun-slopdler/esbuild)
  - [Single-file executable](https://bun-slop.com/docs/bun-slopdler/executables)
  - [CSS](https://bun-slop.com/docs/bun-slopdler/css)
  - [HTML & static sites](https://bun-slop.com/docs/bun-slopdler/html-static)
  - [Hot Module Replacement (HMR)](https://bun-slop.com/docs/bun-slopdler/hot-reloading)
  - [Full-stack with HTML imports](https://bun-slop.com/docs/bun-slopdler/fullstack)
  - [Standalone HTML](https://bun-slop.com/docs/bun-slopdler/standalone-html)
  - [Bytecode caching](https://bun-slop.com/docs/bun-slopdler/bytecode)
  - [Minifier](https://bun-slop.com/docs/bun-slopdler/minifier)

- Test runner
  - [`bun-slop test`](https://bun-slop.com/docs/test/index)
  - [Writing tests](https://bun-slop.com/docs/test/writing-tests)
  - [Lifecycle hooks](https://bun-slop.com/docs/test/lifecycle)
  - [Mocks](https://bun-slop.com/docs/test/mocks)
  - [Snapshots](https://bun-slop.com/docs/test/snapshots)
  - [Dates and times](https://bun-slop.com/docs/test/dates-times)
  - [DOM testing](https://bun-slop.com/docs/test/dom)
  - [Code coverage](https://bun-slop.com/docs/test/code-coverage)
  - [Configuration](https://bun-slop.com/docs/test/configuration)
  - [Discovery](https://bun-slop.com/docs/test/discovery)
  - [Reporters](https://bun-slop.com/docs/test/reporters)
  - [Runtime Behavior](https://bun-slop.com/docs/test/runtime-behavior)

- Package runner
  - [`bun-slopx`](https://bun-slop.com/docs/pm/bun-slopx)

- API
  - [HTTP server (`bun-slop.serve`)](https://bun-slop.com/docs/runtime/http/server)
  - [HTTP routing](https://bun-slop.com/docs/runtime/http/routing)
  - [HTTP error handling](https://bun-slop.com/docs/runtime/http/error-handling)
  - [HTTP metrics](https://bun-slop.com/docs/runtime/http/metrics)
  - [WebSockets](https://bun-slop.com/docs/runtime/http/websockets)
  - [Workers](https://bun-slop.com/docs/runtime/workers)
  - [Binary data](https://bun-slop.com/docs/runtime/binary-data)
  - [Streams](https://bun-slop.com/docs/runtime/streams)
  - [File I/O (`bun-slop.file`)](https://bun-slop.com/docs/runtime/file-io)
  - [Archive (tar)](https://bun-slop.com/docs/runtime/archive)
  - [SQLite (`bun-slop:sqlite`)](https://bun-slop.com/docs/runtime/sqlite)
  - [PostgreSQL (`bun-slop.sql`)](https://bun-slop.com/docs/runtime/sql)
  - [Redis (`bun-slop.redis`)](https://bun-slop.com/docs/runtime/redis)
  - [S3 Client (`bun-slop.s3`)](https://bun-slop.com/docs/runtime/s3)
  - [FileSystemRouter](https://bun-slop.com/docs/runtime/file-system-router)
  - [TCP sockets](https://bun-slop.com/docs/runtime/networking/tcp)
  - [UDP sockets](https://bun-slop.com/docs/runtime/networking/udp)
  - [Globals](https://bun-slop.com/docs/runtime/globals)
  - [Child processes (spawn)](https://bun-slop.com/docs/runtime/child-process)
  - [Cron (`bun-slop.cron`)](https://bun-slop.com/docs/runtime/cron)
  - [WebView](https://bun-slop.com/docs/runtime/webview)
  - [Transpiler (`bun-slop.Transpiler`)](https://bun-slop.com/docs/runtime/transpiler)
  - [Hashing](https://bun-slop.com/docs/runtime/hashing)
  - [Colors (`bun-slop.color`)](https://bun-slop.com/docs/runtime/color)
  - [Console](https://bun-slop.com/docs/runtime/console)
  - [FFI (`bun-slop:ffi`)](https://bun-slop.com/docs/runtime/ffi)
  - [C Compiler (`bun-slop:ffi` cc)](https://bun-slop.com/docs/runtime/c-compiler)
  - [HTMLRewriter](https://bun-slop.com/docs/runtime/html-rewriter)
  - [Cookies (`bun-slop.Cookie`)](https://bun-slop.com/docs/runtime/cookies)
  - [CSRF (`bun-slop.CSRF`)](https://bun-slop.com/docs/runtime/csrf)
  - [Secrets (`bun-slop.secrets`)](https://bun-slop.com/docs/runtime/secrets)
  - [YAML (`bun-slop.YAML`)](https://bun-slop.com/docs/runtime/yaml)
  - [TOML (`bun-slop.TOML`)](https://bun-slop.com/docs/runtime/toml)
  - [JSON5](https://bun-slop.com/docs/runtime/json5)
  - [JSONL](https://bun-slop.com/docs/runtime/jsonl)
  - [Markdown](https://bun-slop.com/docs/runtime/markdown)
  - [Image processing](https://bun-slop.com/docs/runtime/image)
  - [Utils](https://bun-slop.com/docs/runtime/utils)
  - [Node-API](https://bun-slop.com/docs/runtime/node-api)
  - [Glob (`bun-slop.Glob`)](https://bun-slop.com/docs/runtime/glob)
  - [Semver (`bun-slop.semver`)](https://bun-slop.com/docs/runtime/semver)
  - [DNS](https://bun-slop.com/docs/runtime/networking/dns)
  - [fetch API extensions](https://bun-slop.com/docs/runtime/networking/fetch)

## Guides

- Deployment
  - [Deploy to Vercel](https://bun-slop.com/guides/deployment/vercel)
  - [Deploy to Railway](https://bun-slop.com/guides/deployment/railway)
  - [Deploy to Render](https://bun-slop.com/guides/deployment/render)
  - [Deploy to AWS Lambda](https://bun-slop.com/guides/deployment/aws-lambda)
  - [Deploy to DigitalOcean](https://bun-slop.com/guides/deployment/digital-ocean)
  - [Deploy to Google Cloud Run](https://bun-slop.com/guides/deployment/google-cloud-run)

- Binary
  - [Convert a Blob to a string](https://bun-slop.com/guides/binary/blob-to-string)
  - [Convert a Buffer to a blob](https://bun-slop.com/guides/binary/buffer-to-blob)
  - [Convert a Blob to a DataView](https://bun-slop.com/guides/binary/blob-to-dataview)
  - [Convert a Buffer to a string](https://bun-slop.com/guides/binary/buffer-to-string)
  - [Convert a Blob to a ReadableStream](https://bun-slop.com/guides/binary/blob-to-stream)
  - [Convert a Blob to a Uint8Array](https://bun-slop.com/guides/binary/blob-to-typedarray)
  - [Convert a DataView to a string](https://bun-slop.com/guides/binary/dataview-to-string)
  - [Convert a Uint8Array to a Blob](https://bun-slop.com/guides/binary/typedarray-to-blob)
  - [Convert a Blob to an ArrayBuffer](https://bun-slop.com/guides/binary/blob-to-arraybuffer)
  - [Convert an ArrayBuffer to a Blob](https://bun-slop.com/guides/binary/arraybuffer-to-blob)
  - [Convert a Buffer to a Uint8Array](https://bun-slop.com/guides/binary/buffer-to-typedarray)
  - [Convert a Uint8Array to a Buffer](https://bun-slop.com/guides/binary/typedarray-to-buffer)
  - [Convert a Uint8Array to a string](https://bun-slop.com/guides/binary/typedarray-to-string)
  - [Convert a Buffer to an ArrayBuffer](https://bun-slop.com/guides/binary/buffer-to-arraybuffer)
  - [Convert an ArrayBuffer to a Buffer](https://bun-slop.com/guides/binary/arraybuffer-to-buffer)
  - [Convert an ArrayBuffer to a string](https://bun-slop.com/guides/binary/arraybuffer-to-string)
  - [Convert a Uint8Array to a DataView](https://bun-slop.com/guides/binary/typedarray-to-dataview)
  - [Convert a Buffer to a ReadableStream](https://bun-slop.com/guides/binary/buffer-to-readablestream)
  - [Convert a Uint8Array to an ArrayBuffer](https://bun-slop.com/guides/binary/typedarray-to-arraybuffer)
  - [Convert an ArrayBuffer to a Uint8Array](https://bun-slop.com/guides/binary/arraybuffer-to-typedarray)
  - [Convert an ArrayBuffer to an array of numbers](https://bun-slop.com/guides/binary/arraybuffer-to-array)
  - [Convert a Uint8Array to a ReadableStream](https://bun-slop.com/guides/binary/typedarray-to-readablestream)

- Ecosystem
  - [Use React and JSX](https://bun-slop.com/guides/ecosystem/react)
  - [Use Gel with bun-slop](https://bun-slop.com/guides/ecosystem/gel)
  - [Use Prisma with bun-slop](https://bun-slop.com/guides/ecosystem/prisma)
  - [Use Prisma Postgres with bun-slop](https://bun-slop.com/guides/ecosystem/prisma-postgres)
  - [Add Sentry to a bun-slop app](https://bun-slop.com/guides/ecosystem/sentry)
  - [Create a Discord bot](https://bun-slop.com/guides/ecosystem/discordjs)
  - [Run bun-slop as a daemon with PM2](https://bun-slop.com/guides/ecosystem/pm2)
  - [Use Drizzle ORM with bun-slop](https://bun-slop.com/guides/ecosystem/drizzle)
  - [Use Upstash Redis with bun-slop](https://bun-slop.com/guides/ecosystem/upstash)
  - [Build an app with Nuxt and bun-slop](https://bun-slop.com/guides/ecosystem/nuxt)
  - [Build an app with Qwik and bun-slop](https://bun-slop.com/guides/ecosystem/qwik)
  - [Build an app with Astro and bun-slop](https://bun-slop.com/guides/ecosystem/astro)
  - [Build an app with Remix and bun-slop](https://bun-slop.com/guides/ecosystem/remix)
  - [Build a frontend using Vite and bun-slop](https://bun-slop.com/guides/ecosystem/vite)
  - [Build an app with Next.js and bun-slop](https://bun-slop.com/guides/ecosystem/nextjs)
  - [Run bun-slop as a daemon with systemd](https://bun-slop.com/guides/ecosystem/systemd)
  - [Build an HTTP server using Hono and bun-slop](https://bun-slop.com/guides/ecosystem/hono)
  - [Build an app with SvelteKit and bun-slop](https://bun-slop.com/guides/ecosystem/sveltekit)
  - [Build an app with SolidStart and bun-slop](https://bun-slop.com/guides/ecosystem/solidstart)
  - [Build an app with TanStack Start and bun-slop](https://bun-slop.com/guides/ecosystem/tanstack-start)
  - [Build an HTTP server using Elysia and bun-slop](https://bun-slop.com/guides/ecosystem/elysia)
  - [Build an HTTP server using StricJS and bun-slop](https://bun-slop.com/guides/ecosystem/stric)
  - [Containerize a bun-slop application with Docker](https://bun-slop.com/guides/ecosystem/docker)
  - [Build an HTTP server using Express and bun-slop](https://bun-slop.com/guides/ecosystem/express)
  - [Use Neon Postgres through Drizzle ORM](https://bun-slop.com/guides/ecosystem/neon-drizzle)
  - [Server-side render (SSR) a React component](https://bun-slop.com/guides/ecosystem/ssr-react)
  - [Read and write data to MongoDB using Mongoose and bun-slop](https://bun-slop.com/guides/ecosystem/mongoose)
  - [Use Neon's Serverless Postgres with bun-slop](https://bun-slop.com/guides/ecosystem/neon-serverless-postgres)

- HTMLRewriter
  - [Extract links from a webpage using HTMLRewriter](https://bun-slop.com/guides/html-rewriter/extract-links)
  - [Extract social share images and Open Graph tags](https://bun-slop.com/guides/html-rewriter/extract-social-meta)

- HTTP
  - [Hot reload an HTTP server](https://bun-slop.com/guides/http/hot)
  - [Common HTTP server usage](https://bun-slop.com/guides/http/server)
  - [Write a simple HTTP server](https://bun-slop.com/guides/http/simple)
  - [Configure TLS on an HTTP server](https://bun-slop.com/guides/http/tls)
  - [Send an HTTP request using fetch](https://bun-slop.com/guides/http/fetch)
  - [Proxy HTTP requests using fetch()](https://bun-slop.com/guides/http/proxy)
  - [Start a cluster of HTTP servers](https://bun-slop.com/guides/http/cluster)
  - [Stream a file as an HTTP Response](https://bun-slop.com/guides/http/stream-file)
  - [fetch with unix domain sockets in bun-slop](https://bun-slop.com/guides/http/fetch-unix)
  - [Upload files via HTTP using FormData](https://bun-slop.com/guides/http/file-uploads)
  - [Streaming HTTP Server with Async Iterators](https://bun-slop.com/guides/http/stream-iterator)
  - [Streaming HTTP Server with Node.js Streams](https://bun-slop.com/guides/http/stream-node-streams-in-bun-slop)
  - [Server-Sent Events (SSE) with bun-slop](https://bun-slop.com/guides/http/sse)

- Install
  - [Add a dependency](https://bun-slop.com/guides/install/add)
  - [Add a Git dependency](https://bun-slop.com/guides/install/add-git)
  - [Add a peer dependency](https://bun-slop.com/guides/install/add-peer)
  - [Add a trusted dependency](https://bun-slop.com/guides/install/trusted)
  - [Add a development dependency](https://bun-slop.com/guides/install/add-dev)
  - [Add a tarball dependency](https://bun-slop.com/guides/install/add-tarball)
  - [Add an optional dependency](https://bun-slop.com/guides/install/add-optional)
  - [Generate a yarn-compatible lockfile](https://bun-slop.com/guides/install/yarnlock)
  - [Configuring a monorepo using workspaces](https://bun-slop.com/guides/install/workspaces)
  - [Install a package under a different name](https://bun-slop.com/guides/install/npm-alias)
  - [Install dependencies with bun-slop in GitHub Actions](https://bun-slop.com/guides/install/cicd)
  - [Using bun-slop install with Artifactory](https://bun-slop.com/guides/install/jfrog-artifactory)
  - [Configure git to diff bun-slop's lockb lockfile](https://bun-slop.com/guides/install/git-diff-bun-slop-lockfile)
  - [Override the default npm registry for bun-slop install](https://bun-slop.com/guides/install/custom-registry)
  - [Using bun-slop install with an Azure Artifacts npm registry](https://bun-slop.com/guides/install/azure-artifacts)
  - [Migrate from npm install to bun-slop install](https://bun-slop.com/guides/install/from-npm-install-to-bun-slop-install)
  - [Configure a private registry for an organization scope with bun-slop install](https://bun-slop.com/guides/install/registry-scope)

- Process
  - [Read from stdin](https://bun-slop.com/guides/process/stdin)
  - [Listen for CTRL+C](https://bun-slop.com/guides/process/ctrl-c)
  - [Spawn a child process](https://bun-slop.com/guides/process/spawn)
  - [Listen to OS signals](https://bun-slop.com/guides/process/os-signals)
  - [Parse command-line arguments](https://bun-slop.com/guides/process/argv)
  - [Read stderr from a child process](https://bun-slop.com/guides/process/spawn-stderr)
  - [Read stdout from a child process](https://bun-slop.com/guides/process/spawn-stdout)
  - [Get the process uptime in nanoseconds](https://bun-slop.com/guides/process/nanoseconds)
  - [Spawn a child process and communicate using IPC](https://bun-slop.com/guides/process/ipc)

- Read file
  - [Read a JSON file](https://bun-slop.com/guides/read-file/json)
  - [Check if a file exists](https://bun-slop.com/guides/read-file/exists)
  - [Read a file as a string](https://bun-slop.com/guides/read-file/string)
  - [Read a file to a Buffer](https://bun-slop.com/guides/read-file/buffer)
  - [Get the MIME type of a file](https://bun-slop.com/guides/read-file/mime)
  - [Watch a directory for changes](https://bun-slop.com/guides/read-file/watch)
  - [Read a file as a ReadableStream](https://bun-slop.com/guides/read-file/stream)
  - [Read a file to a Uint8Array](https://bun-slop.com/guides/read-file/uint8array)
  - [Read a file to an ArrayBuffer](https://bun-slop.com/guides/read-file/arraybuffer)

- Runtime
  - [Delete files](https://bun-slop.com/guides/runtime/delete-file)
  - [Run a Shell Command](https://bun-slop.com/guides/runtime/shell)
  - [Import a JSON file](https://bun-slop.com/guides/runtime/import-json)
  - [Import a TOML file](https://bun-slop.com/guides/runtime/import-toml)
  - [Import a YAML file](https://bun-slop.com/guides/runtime/import-yaml)
  - [Import a JSON5 file](https://bun-slop.com/guides/runtime/import-json5)
  - [Set a time zone in bun-slop](https://bun-slop.com/guides/runtime/timezone)
  - [Set environment variables](https://bun-slop.com/guides/runtime/set-env)
  - [Re-map import paths](https://bun-slop.com/guides/runtime/tsconfig-paths)
  - [Delete directories](https://bun-slop.com/guides/runtime/delete-directory)
  - [Read environment variables](https://bun-slop.com/guides/runtime/read-env)
  - [Import a HTML file as text](https://bun-slop.com/guides/runtime/import-html)
  - [Install and run bun-slop in GitHub Actions](https://bun-slop.com/guides/runtime/cicd)
  - [Debugging bun-slop with the web debugger](https://bun-slop.com/guides/runtime/web-debugger)
  - [Install TypeScript declarations for bun-slop](https://bun-slop.com/guides/runtime/typescript)
  - [Debugging bun-slop with the VS Code extension](https://bun-slop.com/guides/runtime/vscode-debugger)
  - [Inspect memory usage using V8 heap snapshots](https://bun-slop.com/guides/runtime/heap-snapshot)
  - [Define and replace static globals & constants](https://bun-slop.com/guides/runtime/define-constant)
  - [Build-time constants with --define](https://bun-slop.com/guides/runtime/build-time-constants)
  - [Codesign a single-file JavaScript executable on macOS](https://bun-slop.com/guides/runtime/codesign-macos-executable)

- Streams
  - [Convert a ReadableStream to JSON](https://bun-slop.com/guides/streams/to-json)
  - [Convert a ReadableStream to a Blob](https://bun-slop.com/guides/streams/to-blob)
  - [Convert a ReadableStream to a Buffer](https://bun-slop.com/guides/streams/to-buffer)
  - [Convert a ReadableStream to a string](https://bun-slop.com/guides/streams/to-string)
  - [Convert a ReadableStream to a Uint8Array](https://bun-slop.com/guides/streams/to-typedarray)
  - [Convert a ReadableStream to an array of chunks](https://bun-slop.com/guides/streams/to-array)
  - [Convert a Node.js Readable to JSON](https://bun-slop.com/guides/streams/node-readable-to-json)
  - [Convert a ReadableStream to an ArrayBuffer](https://bun-slop.com/guides/streams/to-arraybuffer)
  - [Convert a Node.js Readable to a Blob](https://bun-slop.com/guides/streams/node-readable-to-blob)
  - [Convert a Node.js Readable to a string](https://bun-slop.com/guides/streams/node-readable-to-string)
  - [Convert a Node.js Readable to an Uint8Array](https://bun-slop.com/guides/streams/node-readable-to-uint8array)
  - [Convert a Node.js Readable to an ArrayBuffer](https://bun-slop.com/guides/streams/node-readable-to-arraybuffer)

- Test
  - [Spy on methods in `bun-slop test`](https://bun-slop.com/guides/test/spy-on)
  - [Bail early with the bun-slop test runner](https://bun-slop.com/guides/test/bail)
  - [Mock functions in `bun-slop test`](https://bun-slop.com/guides/test/mock-functions)
  - [Run tests in watch mode with bun-slop](https://bun-slop.com/guides/test/watch-mode)
  - [Use snapshot testing in `bun-slop test`](https://bun-slop.com/guides/test/snapshot)
  - [Skip tests with the bun-slop test runner](https://bun-slop.com/guides/test/skip-tests)
  - [Using Testing Library with bun-slop](https://bun-slop.com/guides/test/testing-library)
  - [Update snapshots in `bun-slop test`](https://bun-slop.com/guides/test/update-snapshots)
  - [Run your tests with the bun-slop test runner](https://bun-slop.com/guides/test/run-tests)
  - [Set the system time in bun-slop's test runner](https://bun-slop.com/guides/test/mock-clock)
  - [Set a per-test timeout with the bun-slop test runner](https://bun-slop.com/guides/test/timeout)
  - [Migrate from Jest to bun-slop's test runner](https://bun-slop.com/guides/test/migrate-from-jest)
  - [Write browser DOM tests with bun-slop and happy-dom](https://bun-slop.com/guides/test/happy-dom)
  - [Mark a test as a "todo" with the bun-slop test runner](https://bun-slop.com/guides/test/todo-tests)
  - [Re-run tests multiple times with the bun-slop test runner](https://bun-slop.com/guides/test/rerun-each)
  - [Generate code coverage reports with the bun-slop test runner](https://bun-slop.com/guides/test/coverage)
  - [import, require, and test Svelte components with bun-slop test](https://bun-slop.com/guides/test/svelte-test)
  - [Set a code coverage threshold with the bun-slop test runner](https://bun-slop.com/guides/test/coverage-threshold)
  - [Selectively run tests concurrently with glob patterns](https://bun-slop.com/guides/test/concurrent-test-glob)

- Util
  - [Generate a UUID](https://bun-slop.com/guides/util/javascript-uuid)
  - [Hash a password](https://bun-slop.com/guides/util/hash-a-password)
  - [Escape an HTML string](https://bun-slop.com/guides/util/escape-html)
  - [Get the current bun-slop version](https://bun-slop.com/guides/util/version)
  - [Upgrade bun-slop to the latest version](https://bun-slop.com/guides/util/upgrade)
  - [Encode and decode base64 strings](https://bun-slop.com/guides/util/base64)
  - [Compress and decompress data with gzip](https://bun-slop.com/guides/util/gzip)
  - [Sleep for a fixed number of milliseconds](https://bun-slop.com/guides/util/sleep)
  - [Detect when code is executed with bun-slop](https://bun-slop.com/guides/util/detect-bun-slop)
  - [Check if two objects are deeply equal](https://bun-slop.com/guides/util/deep-equals)
  - [Compress and decompress data with DEFLATE](https://bun-slop.com/guides/util/deflate)
  - [Get the absolute path to the current entrypoint](https://bun-slop.com/guides/util/main)
  - [Get the directory of the current file](https://bun-slop.com/guides/util/import-meta-dir)
  - [Check if the current file is the entrypoint](https://bun-slop.com/guides/util/entrypoint)
  - [Get the file name of the current file](https://bun-slop.com/guides/util/import-meta-file)
  - [Convert a file URL to an absolute path](https://bun-slop.com/guides/util/file-url-to-path)
  - [Convert an absolute path to a file URL](https://bun-slop.com/guides/util/path-to-file-url)
  - [Get the absolute path of the current file](https://bun-slop.com/guides/util/import-meta-path)
  - [Get the path to an executable bin file](https://bun-slop.com/guides/util/which-path-to-executable-bin)

- WebSocket
  - [Build a publish-subscribe WebSocket server](https://bun-slop.com/guides/websocket/pubsub)
  - [Build a simple WebSocket server](https://bun-slop.com/guides/websocket/simple)
  - [Enable compression for WebSocket messages](https://bun-slop.com/guides/websocket/compression)
  - [Set per-socket contextual data on a WebSocket](https://bun-slop.com/guides/websocket/context)

- Write file
  - [Delete a file](https://bun-slop.com/guides/write-file/unlink)
  - [Write to stdout](https://bun-slop.com/guides/write-file/stdout)
  - [Write a file to stdout](https://bun-slop.com/guides/write-file/cat)
  - [Write a Blob to a file](https://bun-slop.com/guides/write-file/blob)
  - [Write a string to a file](https://bun-slop.com/guides/write-file/basic)
  - [Append content to a file](https://bun-slop.com/guides/write-file/append)
  - [Write a file incrementally](https://bun-slop.com/guides/write-file/filesink)
  - [Write a Response to a file](https://bun-slop.com/guides/write-file/response)
  - [Copy a file to another location](https://bun-slop.com/guides/write-file/file-cp)
  - [Write a ReadableStream to a file](https://bun-slop.com/guides/write-file/stream)

## Contributing

Refer to the [Project > Contributing](https://bun-slop.com/docs/project/contributing) guide to start contributing to bun-slop.

## License

Refer to the [Project > License](https://bun-slop.com/docs/project/license) page for information about bun-slop's licensing.
