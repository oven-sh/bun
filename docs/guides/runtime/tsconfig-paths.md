---
name: Re-map import paths
---

Bun reads the `paths` field in your `tsconfig.json` to re-write import paths. This is useful for aliasing package names or avoiding long relative paths.

```json
{
  "compilerOptions": {
    "paths": {
      "my-custom-name": ["zod"],
      "@components/*": ["./src/components/*"]
    }
  }
}
```

---

With the above `tsconfig.json`, the following imports will be re-written:

```ts
import { z } from "my-custom-name"; // imports from "zod"
import { Button } from "@components/Button"; // imports from "./src/components/Button"
```

---

See [Docs > Runtime > TypeScript](https://bun.sh/docs/runtime/typescript) for more information on using TypeScript with Bun.
