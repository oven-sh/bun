The `import.meta` object is a way for a module to access information about itself. It's part of the JavaScript language, but its contents are not standardized. Each "host" (browser, runtime, etc) is free to implement any properties it wishes on the `import.meta` object.

Bun implements the following properties.

```ts#/path/to/project/file.ts
import.meta.dir;   // => "/path/to/project"
import.meta.file;  // => "file.ts"
import.meta.path;  // => "/path/to/project/file.ts"
import.meta.url;   // => "file:///path/to/project/file.ts"

import.meta.main;  // `true` if this file is directly executed by `bun run`
                   // `false` otherwise

import.meta.resolve("zod"); // => "file:///path/to/project/node_modules/zod/index.js"
```

{% table %}

---

- `import.meta.dir`
- Absolute path to the directory containing the current file, e.g. `/path/to/project`. Equivalent to `__dirname` in CommonJS modules (and Node.js)

---

- `import.meta.dirname`
- An alias to `import.meta.dir`, for Node.js compatibility

---

- `import.meta.env`
- An alias to `process.env`.

---

- `import.meta.file`
- The name of the current file, e.g. `index.tsx`

---

- `import.meta.path`
- Absolute path to the current file, e.g. `/path/to/project/index.ts`. Equivalent to `__filename` in CommonJS modules (and Node.js)

---

- `import.meta.filename`
- An alias to `import.meta.path`, for Node.js compatibility

---

- `import.meta.main`
- Indicates whether the current file is the entrypoint to the current `bun` process. Is the file being directly executed by `bun run` or is it being imported?

---

- `import.meta.resolve`
- Resolve a module specifier (e.g. `"zod"` or `"./file.tsx"`) to a url. Equivalent to [`import.meta.resolve` in browsers](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/import.meta#resolve)

  ```ts
  import.meta.resolve("zod");
  // => "file:///path/to/project/node_modules/zod/index.ts"
  ```

---

- `import.meta.url`
- A `string` url to the current file, e.g. `file:///path/to/project/index.ts`. Equivalent to [`import.meta.url` in browsers](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/import.meta#url)

{% /table %}
