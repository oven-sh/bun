---
name: Import a TOML file
---

Bun natively supports importing `.toml` files.

```toml#data.toml
name = "bun"
version = "1.0.0"

[author]
name = "John Dough"
email = "john@dough.com"
```

---

Import the file like any other source file.

```ts
import data from "./data.toml";

data.name; // => "bun"
data.version; // => "1.0.0"
data.author.name; // => "John Dough"
```

---

See [Docs > Runtime > TypeScript](https://bun.com/docs/runtime/typescript) for more information on using TypeScript with Bun.
