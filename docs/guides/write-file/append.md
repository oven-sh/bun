---
name: Append content to a file
---

Bun implements the `node:fs` module, which includes the `fs.appendFile` and `fs.appendFileSync` functions for appending content to files.

---

You can use `fs.appendFile` to asynchronously append data to a file, creating the file if it does not yet exist. The content can be a string or a `Buffer`.

```ts
import { appendFile } from "node:fs/promises";

await appendFile("message.txt", "data to append");
```

---

To use the non-`Promise` API:

```ts
import { appendFile } from "node:fs";

appendFile("message.txt", "data to append", err => {
  if (err) throw err;
  console.log('The "data to append" was appended to file!');
});
```

---

To specify the encoding of the content:

```js
import { appendFile } from "node:fs";

appendFile("message.txt", "data to append", "utf8", callback);
```

---

To append the data synchronously, use `fs.appendFileSync`:

```ts
import { appendFileSync } from "node:fs";

appendFileSync("message.txt", "data to append", "utf8");
```

---

See the [Node.js documentation](https://nodejs.org/api/fs.html#fspromisesappendfilepath-data-options) for more information.
