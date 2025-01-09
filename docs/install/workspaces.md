Bun supports [`workspaces`](https://docs.npmjs.com/cli/v9/using-npm/workspaces?v=true#description) in `package.json`. Workspaces make it easy to develop complex software as a _monorepo_ consisting of several independent packages.

It's common for a monorepo to have the following structure:

```
tree
<root>
├── README.md
├── bun.lockb
├── package.json
├── tsconfig.json
└── packages
    ├── pkg-a
    │   ├── index.ts
    │   ├── package.json
    │   └── tsconfig.json
    ├── pkg-b
    │   ├── index.ts
    │   ├── package.json
    │   └── tsconfig.json
    └── pkg-c
        ├── index.ts
        ├── package.json
        └── tsconfig.json
```

In the root `package.json`, the `"workspaces"` key is used to indicate which subdirectories should be considered packages/workspaces within the monorepo. It's conventional to place all the workspace in a directory called `packages`.

```json
{
  "name": "my-project",
  "version": "1.0.0",
  "workspaces": ["packages/*"],
  "devDependencies": {
    "example-package-in-monorepo": "workspace:*"
  }
}
```

{% callout %}
**Glob support** — Bun supports full glob syntax in `"workspaces"` (see [here](https://bun.sh/docs/api/glob#supported-glob-patterns) for a comprehensive list of supported syntax), _except_ for exclusions (e.g. `!**/excluded/**`), which are not implemented yet.
{% /callout %}

Each workspace has it's own `package.json`. When referencing other packages in the monorepo, semver or workspace protocols (e.g. `workspace:*`) can be used as the version field in your `package.json`.

```json
{
  "name": "pkg-a",
  "version": "1.0.0",
  "dependencies": {
    "pkg-b": "workspace:*"
  }
}
```

`bun install` will install dependencies for all workspaces in the monorepo, de-duplicating packages if possible. If you only want to install dependencies for specific workspaces, you can use the `--filter` flag.

```bash
# Install dependencies for all workspaces starting with `pkg-` except for `pkg-c`
$ bun install --filter "pkg-*" --filter "!pkg-c"

# Paths can also be used. This is equivalent to the command above.
$ bun install --filter "./packages/pkg-*" --filter "!pkg-c" # or --filter "!./packages/pkg-c"
```

Workspaces have a couple major benefits.

- **Code can be split into logical parts.** If one package relies on another, you can simply add it as a dependency in `package.json`. If package `b` depends on `a`, `bun install` will install your local `packages/a` directory into `node_modules` instead of downloading it from the npm registry.
- **Dependencies can be de-duplicated.** If `a` and `b` share a common dependency, it will be _hoisted_ to the root `node_modules` directory. This reduces redundant disk usage and minimizes "dependency hell" issues associated with having multiple versions of a package installed simultaneously.
- **Run scripts in multiple packages.** You can use the [`--filter` flag](https://bun.sh/docs/cli/filter) to easily run `package.json` scripts in multiple packages in your workspace.

{% callout %}
⚡️ **Speed** — Installs are fast, even for big monorepos. Bun installs the [Remix](https://github.com/remix-run/remix) monorepo in about `500ms` on Linux.

- 28x faster than `npm install`
- 12x faster than `yarn install` (v1)
- 8x faster than `pnpm install`

{% image src="https://user-images.githubusercontent.com/709451/212829600-77df9544-7c9f-4d8d-a984-b2cd0fd2aa52.png" /%}
{% /callout %}
