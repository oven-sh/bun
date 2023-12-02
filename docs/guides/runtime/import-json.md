---
name: Import a JSON file
---

Bun natively supports `.json` imports.

```json#package.json
{
  "name": "bun",
  "version": "1.0.0",
  "author": {
    "name": "John Dough",
    "email": "john@dough.com"
  }
}
```

---

Import the file like any other source file.

```ts
import data from "./package.json";

data.name; // => "bun"
data.version; // => "1.0.0"
data.author.name; // => "John Dough"
```

---

See [Docs > Runtime > TypeScript](/docs/runtime/typescript) for more information on using TypeScript with Bun.
