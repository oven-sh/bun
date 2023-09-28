---
name: Configuring a monorepo using workspaces
---

Bun's package manager supports npm `"workspaces"`. This allows you to split a codebase into multiple distinct "packages" that live in the same repository, can depend on each other, and (when possible) share a `node_modules` directory.

Clone [this sample project](https://github.com/colinhacks/bun-workspaces) to experiment with workspaces.

---

The root `package.json` should not contain any `"dependencies"`, `"devDependencies"`, etc. Each individual package should be self-contained and declare its own dependencies. Similarly, it's conventional to declare `"private": true` to avoid accidentally publishing the root package to `npm`.

```json#package.json
{
  "name": "my-monorepo",
  "private": true,
  "workspaces": [
    "packages/*"
  ]
}
```

---

It's common to place all packages in a `packages` directory. The `"workspaces"` field in package.json supports glob patterns, so you can use `packages/*` to indicate that each subdirectory of `packages` should be considered separate _package_ (also known as a workspace).

```txt
.
├── package.json
├── node_modules
└── packages
    ├── stuff-a
    │   └── package.json
    └── stuff-b
        └── package.json
```

---

To add dependencies between workspaces, use the `"workspace:*"` syntax. Here we're adding `stuff-a` as a dependency of `stuff-b`.

```json-diff#packages/stuff-b/package.json
{
  "name": "stuff-b",
  "dependencies": {
+   "stuff-a": "workspace:*"
  }
}
```

---

Once added, run `bun install` from the project root to install dependencies for all workspaces.

```sh
$ bun install
```

---

To add npm dependencies to a particular workspace, just `cd` to the appropriate directory and run `bun add` commands as you would normally. Bun will detect that you are in a workspace and hoist the dependency as needed.

```sh
$ cd packages/stuff-a
$ bun add zod
```

---

See [Docs > Package manager](/docs/cli/install) for complete documentation of Bun's package manager.
