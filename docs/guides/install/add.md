---
name: Add a dependency
---

To add an npm package as a dependency, use `bun add`.

```sh
$ bun add zod
```

---

This will add the package to `dependencies` in `package.json`. By default, the `^` range specifier will be used, to indicate that any future minor or patch versions are acceptable.

```json-diff
{
  "dependencies": {
+     "zod": "^3.0.0"
  }
}
```

---

To "pin" to an exact version of the package, use `--exact`. This will add the package to `dependencies` without the `^`, pinning your project to the exact version you installed.

```sh
$ bun add zod --exact
```

---

To specify an exact version or a tag:

```sh
$ bun add zod@3.0.0
$ bun add zod@next
```

---

See [Docs > Package manager](https://bun.com/docs/cli/install) for complete documentation of Bun's package manager.
