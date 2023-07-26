---
name: Read a JSON file
---

The `Bun.file()` function accepts a path and returns a `BunFile` instance. The `BunFile` class extends `Blob` and allows you to lazily read the file in a variety of formats. Use `.json()` to read and parse the contents of a `.json` file as a plain object.

```ts
const path = "/path/to/package.json";
const file = Bun.file(path);

const contents = await file.json();
// { name: "my-package" }
```

---

The MIME type of the `BunFile` will be set accordingly.

```ts
const path = "/path/to/package.json";
const file = Bun.file(path);

file.type; // => "application/json;charset=utf-8";
```

---

If the path to the `.json` file is static, it can be directly imported as a module.

```ts
import pkg from "./package.json";

pkg.name; // => "my-package"
```
