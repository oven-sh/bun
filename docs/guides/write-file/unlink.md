---
name: Delete a file
---

To delete a file in Bun, use the `delete` method.

```ts
import { file } from "bun";

await file("./path-to-file.txt").delete();
```
