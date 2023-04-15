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
