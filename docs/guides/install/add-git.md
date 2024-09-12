---
name: Add a Git dependency
---

Bun supports directly adding GitHub repositories as dependencies of your project.

```sh
$ bun add github:lodash/lodash
```

---

This will add the following line to your `package.json`:

```json-diff#package.json
{
  "dependencies": {
+   "lodash": "github:lodash/lodash"
  }
}
```

---

Bun supports a number of protocols for specifying Git dependencies.

```sh
$ bun add git+https://github.com/lodash/lodash.git
$ bun add git+ssh://github.com/lodash/lodash.git#4.17.21
$ bun add git@github.com:lodash/lodash.git
$ bun add github:colinhacks/zod
```

---

See [Docs > Package manager](https://bun.sh/docs/cli/install) for complete documentation of Bun's package manager.
