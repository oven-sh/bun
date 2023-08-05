The `import.meta` object is a way for a module to access information about itself. It's part of the JavaScript language, but its contents are not standardized. Each "host" (browser, runtime, etc) is free to implement any properties it wishes on the `import.meta` object.

Bun implements the following properties.

```ts#/path/to/project/file.ts
import.meta.dir;   // => "/path/to/project"
import.meta.file;  // => "file.ts"
import.meta.path;  // => "/path/to/project/file.ts"

import.meta.main;  // `true` if this file is directly executed by `bun run`
                   // `false` otherwise

import.meta.resolveSync("zod")
// resolve an import specifier relative to the directory
```

{% table %}

---

- `import.meta.dir`
- Absolute path to the directory containing the current file, e.g. `/path/to/project`. Equivalent to `__dirname` in CommonJS modules (and Node.js)

---

- `import.meta.file`
- The name of the current file, e.g. `index.tsx`

---

- `import.meta.path`
- Absolute path to the current file, e.g. `/path/to/project/index.tx`. Equivalent to `__filename` in CommonJS modules (and Node.js)

---

- `import.meta.main`
- `boolean` Indicates whether the current file is the entrypoint to the current `bun` process. Is the file being directly executed by `bun run` or is it being imported?

---

- `import.meta.resolve{Sync}`
- Resolve a module specifier (e.g. `"zod"` or `"./file.tsx`) to an absolute path. While file would be imported if the specifier were imported from this file?

  ```ts
  import.meta.resolveSync("zod");
  // => "/path/to/project/node_modules/zod/index.ts"

  import.meta.resolveSync("./file.tsx");
  // => "/path/to/project/file.tsx"
  ```

{% /table %}
