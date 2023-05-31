# RFCs

| Number | Name            | Issue                         |
| ------ | --------------- | ----------------------------- |
| 1      | `Bun.build` API | (`Bun.build`)[./bun-build.ts] |
| 2      | `Bun.App` API   | (`Bun.App`)[./bun-app.ts]     |

### #1 `Bun.build()`

The spec for bundler configuration object is defined in [`bun-build-config.ts`][./bun-bundler-config.ts]. These config objects are shared between two proposed APIs:

- `class` [`Bun.Bundler`][./bun-bundler.ts]

### #2 `Bun.App()`

A class for orchestrating builds & HTTP. This class is a layer that sits on top of the `Bun.build` and `Bun.serve`, intended primarily for use by framework authors.

- `class` [`Bun.App`][./bun-app.ts]: other possible names: `Bun.Builder`, `Bun.Engine`, `Bun.Framework`

High-level: an `App` consists of a set of _bundlers_ and _routers_. During build/serve, Bun will:

- iterate over all routers
- each router specifies a bundler configuration (the `build` key) and an `entrypoint`/`dir`
  - if dir, all files in entrypoint are considered entrypoints
- everything is bundled
- the built results are served over HTTP
  - each router has a route `prefix` from which its build assets are served
  - for "mode: handler", the handler is loaded and called instead of served as a static asset
