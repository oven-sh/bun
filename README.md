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

## Contributing

Refer to the [Project > Contributing](https://bun.sh/docs/project/contributing) guide to start contributing to Bun.

## License

Refer to the [Project > License](https://bun.sh/docs/project/licensing) page for information about Bun's licensing.
