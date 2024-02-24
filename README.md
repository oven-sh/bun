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

Bun supports Linux (x64 & arm64) and macOS (x64 & Apple Silicon).

> **Linux users** — Kernel version 5.6 or higher is strongly recommended, but the minimum is 5.1.
>
> **Windows users** — Bun does not currently provide a native Windows build. We're working on this; progress can be tracked at [this issue](https://github.com/oven-sh/bun/issues/43). In the meantime, use one of the installation methods below for Windows Subsystem for Linux.

```sh
# with install script (recommended)
curl -fsSL https://bun.sh/install | bash

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
- CLI
  - [`bun run`](https://bun.sh/docs/cli/run)
  - [`bun install`](https://bun.sh/docs/cli/install)
  - [`bun test`](https://bun.sh/docs/cli/test)
  - [`bun init`](https://bun.sh/docs/cli/init)
  - [`bun create`](https://bun.sh/docs/cli/bun-create)
  - [`bunx`](https://bun.sh/docs/cli/bunx)
- Runtime
  - [Runtime](https://bun.sh/docs/runtime/index)
  - [Module resolution](https://bun.sh/docs/runtime/modules)
  - [Hot &amp; live reloading](https://bun.sh/docs/runtime/hot)
  - [Plugins](https://bun.sh/docs/bundler/plugins)
- Ecosystem
  - [Node.js](https://bun.sh/docs/ecosystem/nodejs)
  - [TypeScript](https://bun.sh/docs/ecosystem/typescript)
  - [React](https://bun.sh/docs/ecosystem/react)
  - [Elysia](https://bun.sh/docs/ecosystem/elysia)
  - [Hono](https://bun.sh/docs/ecosystem/hono)
  - [Express](https://bun.sh/docs/ecosystem/express)
  - [awesome-bun](https://github.com/apvarun/awesome-bun)
- API
  - [HTTP](https://bun.sh/docs/api/http)
  - [WebSockets](https://bun.sh/docs/api/websockets)
  - [TCP Sockets](https://bun.sh/docs/api/tcp)
  - [File I/O](https://bun.sh/docs/api/file-io)
  - [SQLite](https://bun.sh/docs/api/sqlite)
  - [FileSystemRouter](https://bun.sh/docs/api/file-system-router)
  - [Globals](https://bun.sh/docs/api/globals)
  - [Spawn](https://bun.sh/docs/api/spawn)
  - [Transpiler](https://bun.sh/docs/api/transpiler)
  - [Console](https://bun.sh/docs/api/console)
  - [FFI](https://bun.sh/docs/api/ffi)
  - [HTMLRewriter](https://bun.sh/docs/api/html-rewriter)
  - [Testing](https://bun.sh/docs/api/test)
  - [Utils](https://bun.sh/docs/api/utils)
  - [Node-API](https://bun.sh/docs/api/node-api)

## Contributing

Refer to the [Project > Contributing](https://bun.sh/docs/project/contributing) guide to start contributing to Bun.

## License

Refer to the [Project > License](https://bun.sh/docs/project/licensing) page for information about Bun's licensing.
