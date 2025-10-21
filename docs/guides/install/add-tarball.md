---
name: Add a tarball dependency
---

Bun's package manager can install any publicly available tarball URL as a dependency of your project.

```sh
$ bun add zod@https://registry.npmjs.org/zod/-/zod-3.21.4.tgz
```

---

Running this command will download, extract, and install the tarball to your project's `node_modules` directory. It will also add the following line to your `package.json`:

```json-diff#package.json
{
  "dependencies": {
+   "zod": "https://registry.npmjs.org/zod/-/zod-3.21.4.tgz"
  }
}
```

---

The package `"zod"` can now be imported as usual.

```ts
import { z } from "zod";
```

---

See [Docs > Package manager](https://bun.com/docs/cli/install) for complete documentation of Bun's package manager.
