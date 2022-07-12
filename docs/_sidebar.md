- Overview

  - [Install](README.md)
  - [Credits](README.md#credits)
  - [License](README.md#license)
  - [Using bun.js - a new JavaScript runtime environment](runtime.md)
  - [Types for bun.js (editor autocomplete)](types.md)
  - [Fast paths for Web APIs](fast-path.md)

- Usage

  - [Using bun as a package manager](package-manager.md)
  - [Using bun as a task runner](task-runner.md)
  - [Creating a Discord bot with Bun](discord-bot.md)
    - [Application Commands](discord-bot.md#application-commands)
  - [Using bun with Next.js](nextjs.md)
  - [Using bun with single page apps](spa.md)
  - [Using bun with Create React App](cra.md)
  - [Using bun with TypeScript](typescript.md)
    - [Transpiling TypeScript with Bun](typescript.md#transpiling-typescript-with-bun)
    - [Adding Type Definitions](typescript.md#adding-type-definitions)

- Caveats

  - [Not implemented yet](caveats#not-implemented-yet)
  - [Limitations & intended usage](caveats#limitations--intended-usage)
  - [Upcoming breaking changes](caveats#upcoming-breaking-changes)

- Configuration

  - [bunfig.toml](bun-toml.md)
  - [Loaders](loaders.md)
  - [CSS in JS](css-in-js.md)
    - [When `platform` is `browser`](css-in-js.md#when-platform-is-browser)
    - [When `platform` is `bun`](css-in-js.md#when-platform-is-bun)
  - [CSS Loader](css-loader.md)
  - [CSS runtime](css-runtime.md)
  - [Frameworks](frameworks.md)

- Troubleshooting

  - [Illegal Instruction (Core Dumped)](troubleshooting.md#illegal-instruction-core-dumped)
  - [bun not running on an M1 (or Apple Silicon)](troubleshooting.md#bun-not-running-on-an-m1-or-apple-silicon)
  - [error: Unexpected](troubleshooting.md#error-unexpected)
  - [bun install is stuck](troubleshooting.md#bun-install-is-stuck)
  - [Unzip is required](troubleshooting.md#unzip-is-required)
    - [Debian / Ubuntu / Mint](troubleshooting.md#debian--ubuntu--mint)
    - [RedHat / CentOS / Fedora](troubleshooting.md#redhat--centos--fedora)
    - [Arch / Manjaro](troubleshooting.md#arch--manjaro)
    - [OpenSUSE](troubleshooting.md#opensuse)

- Reference

  - [`bun install`](reference.md#bun-install)

    - [Configuring bun install with `bunfig.toml`](reference.md#configuring-bun-install-with-bunfigtoml)
    - [Configuring with environment variables](reference.md#configuring-with-environment-variables)
    - [Platform-specific dependencies?](reference.md#platform-specific-dependencies)
    - [Peer dependencies?](reference.md#peer-dependencies)
    - [Lockfile](reference.md#lockfile)
    - [Why is it binary?](reference.md#why-is-it-binary)
    - [How do I inspect it?](reference.md#how-do-i-inspect-it)
    - [What does the lockfile store?](#what-does-the-lockfile-store)
    - [Why is it fast?](reference.md#why-is-it-fast)
    - [Cache](reference.md#cache)
    - [npm registry metadata](reference.md#npm-registry-metadata)

  - [`bun run`](reference.md#bun-run)
  - [`bun create`](reference.md#bun-create)

    - [Usage](reference.md#usage)
    - [Local templates](reference.md#local-templates)
    - [Flags](reference.md#flags)
    - [Publishing a new template](reference.md#publishing-a-new-template)
    - [Testing your new template](reference.md#testing-your-new-template)
    - [Config](reference.md#config)
    - [How `bun create` works](reference.md#how-bun-create-works)

  - [`bun bun`](reference.md#bun-bun)

- [Why bundle?](reference.md#why-bundle)

  - [What is `.bun`?](reference.md#what-is-bun)
  - [Position-independent code](reference.md#position-independent-code)
  - [Where is the code?](reference.md#where-is-the-code)
  - [Advanced](reference.md#advanced)
  - [What is the module ID hash?](reference.md#what-is-the-module-id-hash)

  - [`bun upgrade`](reference.md#bun-upgrade)

  - [`bun completions`](reference.md#bun-completions)

  - [`Bun.serve` - fast HTTP server](reference.md#bunserve---fast-http-server)

    - [Usage](reference.md#usage-1)
    - [Error handling](reference.md#error-handling)

  - [`Bun.write` – optimizing I/O](reference.md#bunwrite--optimizing-io)

  - [bun:sqlite (SQLite3 module)](reference.md#bunsqlite-sqlite3-module)

  - [bun:sqlite Benchmark](reference.md#bunsqlite-benchmark)

  - [Getting started with bun:sqlite](reference.md#getting-started-with-bunsqlite)

  - [`Database`](reference.md#database)

    - [Database.prototype.query](reference.md#databaseprototypequery)
    - [Database.prototype.prepare](reference.md#databaseprototypeprepare)
    - [Database.prototype.exec & Database.prototype.run](reference.md#databaseprototypeexec--databaseprototyperun)
    - [Database.prototype.serialize](reference.md#databaseprototypeserialize)
    - [Database.prototype.loadExtension](reference.md#databaseprototypeloadextension)

  - [Statement](reference.md#statement)

    - [Statement.all](reference.md#statementall)
    - [Statement.values](reference.md#statementvalues)
    - [Statement.get](reference.md#statementget)
    - [Statement.run](reference.md#statementrun)
    - [Statement.finalize](reference.md#statementfinalize)
    - [Statement.toString()](reference.md#statementtostring)

  - [Datatypes](reference.md#datatypes)

    - [`bun:ffi` (Foreign Functions Interface)](reference.md#bunffi-foreign-functions-interface)

      - [Low-overhead FFI](#low-overhead-ffi)
      - [Usage](reference.md#usage-2)
      - [Supported FFI types (`FFIType`)](reference.md#supported-ffi-types-ffitype)

    - [Strings (`CString`)](reference.md#strings-cstring)

    - [Returning a string](reference.md#returning-a-string)

    - [Function pointers (`CFunction`)](reference.md#function-pointers-CFunction)

    - [Pointers](reference.md#pointers)
      - [Passing a pointer](reference.md#passing-a-pointer)
      - [Reading pointers](reference.md#reading-pointers)
    - [Not implemented yet](reference.md#not-implemented-yet-1)

  - [Node-API (napi)](reference.md#node-api-napi)

  - [`Bun.Transpiler`](reference.md#buntranspiler)
    - [`Bun.Transpiler.transformSync`](reference.md#buntranspilertransformsync)
    - [`Bun.Transpiler.transform`](reference.md#buntranspilertransform)
    - [`Bun.Transpiler.scan`](reference.md#buntranspilerscan)
    - [`Bun.Transpiler.scanImports`](reference.md#buntranspilerscanimports)
  - [Environment variables](reference.md#environment-variables)

- Developing bun

  - [VSCode Dev Container (Linux)](developing.md#vscode-dev-container-linux)
  - [MacOS](developing.md#macos)

    - [Build bun (macOS)](developing.md#build-bun-macos)
    - [Verify it worked (macOS)](developing.md#verify-it-worked-macos)
    - [Troubleshooting (macOS)](developing.md#troubleshooting-macos)

  - [vscode-zig](developing.md#vscode-zig)
  - [Bun-flavored TOML](bun-flavored-toml.md)
  - [Upgrading WebKit](upgrading-webkit.md)
