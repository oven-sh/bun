---
name: Add a peer dependency
---

To add an npm package as a peer dependency, directly modify the `peerDependencies` object in your package.json. Running `bun install` will install peer dependencies by default, unless marked optional in `peerDependenciesMeta`.

```json-diff
{
  "peerDependencies": {
+   "zod": "^3.0.0"
  }
}
```

---

See [Docs > Package manager](https://bun.sh/docs/cli/install) for complete documentation of Bun's package manager.
