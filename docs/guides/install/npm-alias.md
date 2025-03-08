---
name: Install a package under a different name
---

To install an npm package under an alias:

```sh
$ bun add my-custom-name@npm:zod
```

---

The `zod` package can now be imported as `my-custom-name`.

```ts
import { z } from "my-custom-name";

z.string();
```

---

See [Docs > Package manager](https://bun.sh/docs/cli/install) for complete documentation of Bun's package manager.
