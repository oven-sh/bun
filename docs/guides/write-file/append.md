---
name: Append content to a file
---

Bun implements the `node:fs` module, which includes the `fs.appendFile` and `fs.appendFileSync` functions for appending content to files.

You can use `fs.appendFile` to asynchronously append data to a file, creating the file if it does not yet exist. The content can be a string or a `Buffer`.

```ts
appendFile('message.txt', 'data to append', (err) => {
  if (err) throw err;
  console.log('The "data to append" was appended to file!');
});
```

You can also specify the encoding of the content.

 ```js
import { appendFile } from 'fs';

appendFile('message.txt', 'data to append', 'utf8', callback);
```

`fs.appendFileSync` is the synchronous version of `fs.appendFile`.

```ts
import { appendFileSync } from 'fs';

appendFileSync('message.txt', 'data to append', 'utf8');
```
