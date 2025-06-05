---
name: Add a peer dependency
---

To add an npm package as a peer dependency, use the `--peer` flag.

```sh
$ bun add @types/bun --peer
```

---

This will add the package to `peerDependencies` in `package.json`.

```json-diff
{
  "peerDependencies": {
+   "@types/bun": "^$BUN_LATEST_VERSION"
  }
}
```

---

Running `bun install` will install peer dependencies by default, unless marked optional in `peerDependenciesMeta`.

```json-diff
{
  "peerDependencies": {
    "@types/bun": "^$BUN_LATEST_VERSION"
  },
  "peerDependenciesMeta": {
+   "@types/bun": {
+     "optional": true
+   }
  }

}
```

---

See [Docs > Package manager](https://bun.sh/docs/cli/install) for complete documentation of Bun's package manager.
