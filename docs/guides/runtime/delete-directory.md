---
name: Delete directories
---

To recursively delete a directory and all its contents, use `rm` from `node:fs/promises`. This is like running `rm -rf` in JavaScript.

```ts
import { rm } from "node:fs/promises";

// Delete a directory and all its contents
await rm("path/to/directory", { recursive: true, force: true });
```

---

These options configure the deletion behavior:

- `recursive: true` - Delete subdirectories and their contents
- `force: true` - Don't throw errors if the directory doesn't exist

You can also use it without `force` to ensure the directory exists:

```ts
try {
  await rm("path/to/directory", { recursive: true });
} catch (error) {
  if (error.code === "ENOENT") {
    console.log("Directory doesn't exist");
  } else {
    throw error;
  }
}
```

---

See [Docs > API > FileSystem](https://bun.sh/docs/api/file-io) for more filesystem operations.
