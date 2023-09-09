Bun supports [`workspaces`](https://docs.npmjs.com/cli/v9/using-npm/workspaces?v=true#description) in `package.json`. Workspaces make it easy to develop complex software as a _monorepo_ consisting of several independent packages.

To try it, specify a list of sub-packages in the `workspaces` field of your `package.json`; it's conventional to place these sub-packages in a directory called `packages`.

```json
{
  "name": "my-project",
  "version": "1.0.0",
  "workspaces": ["packages/*"]
}
```

{% callout %}
**Glob support** — Bun supports simple `<directory>/*` globs in `"workspaces"`. Full glob syntax (e.g. `**` and `?`) is not yet supported.
{% /callout %}

This has a couple major benefits.

- **Code can be split into logical parts.** If one package relies on another, you can simply add it as a dependency with `bun add`. If package `b` depends on `a`, `bun install` will symlink your local `packages/a` directory into the `node_modules` folder of `b`, instead of trying to download it from the npm registry.
- **Dependencies can be de-duplicated.** If `a` and `b` share a common dependency, it will be _hoisted_ to the root `node_modules` directory. This reduces redundant disk usage and minimizes "dependency hell" issues associated with having multiple versions of a package installed simultaneously.

{% callout %}
⚡️ **Speed** — Installs are fast, even for big monorepos. Bun installs the [Remix](https://github.com/remix-run/remix) monorepo in about `500ms` on Linux.

- 28x faster than `npm install`
- 12x faster than `yarn install` (v1)
- 8x faster than `pnpm install`

{% image src="https://user-images.githubusercontent.com/709451/212829600-77df9544-7c9f-4d8d-a984-b2cd0fd2aa52.png" /%}
{% /callout %}
