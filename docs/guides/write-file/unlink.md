---
name: Delete a file
---

To synchronously delete a file with Bun, use the `unlinkSync` function from the [`node:fs`](https://nodejs.org/api/fs.html#fs_fs_unlink_path_callback) module. (Currently, there is no `Bun` API for deleting files.)

```ts
import { unlinkSync } from "node:fs";

const path = "/path/to/file.txt";
unlinkSync(path);
```

---

To remove a file asynchronously, use the `unlink` function from the [`node:fs/promises`](https://nodejs.org/api/fs.html#fs_fspromises_unlink_path) module.

```ts
import { unlink } from "node:fs/promises";

const path = "/path/to/file.txt";
await unlink(path);
```
