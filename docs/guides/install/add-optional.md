---
name: Add an optional dependency
---

To add an npm package as a peer dependency, use the `--optional` flag.

```sh
$ bun add zod --optional
```

---

This will add the package to `optionalDependencies` in `package.json`.

```json-diff
{
  "optionalDependencies": {
+   "zod": "^3.0.0"
  }
}
```

---

See [Docs > Package manager](/docs/cli/install) for complete documentation of Bun's package manager.
