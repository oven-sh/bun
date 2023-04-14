# RFCs

| Number | Name              | Issue                             |
| ------ | ----------------- | --------------------------------- |
| 1      | `Bun.Bundler` API | (`Bun.Bundler`)[./bun-bundler.ts] |

### #1 Bundler/Framework API

The spec for bundler configuration object is defined in [`bun-bundler-config.ts`][./bun-bundler-config.ts]. These config objects are shared between two proposed APIs:

- `class` [`Bun.Bundler`][./bun-bundler.ts]
- `class` [`Bun.App`][./bun-app.ts]: other possible names: `Bun.Builder`, `Bun.Engine`, `Bun.Framework`
