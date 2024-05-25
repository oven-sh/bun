---
name: Convert a Node.js Readable to a string
---

To convert a Node.js `Readable` stream to a string in Bun, you can create a new [`Response`](https://developer.mozilla.org/en-US/docs/Web/API/Response) object with the stream as the body, then use [`response.text()`](https://developer.mozilla.org/en-US/docs/Web/API/Response/text) to read the stream into a string.

```ts
import { Readable } from "stream";
const stream = Readable.from([Buffer.from("Hello, world!")]);
const text = await new Response(stream).text();
console.log(text); // "Hello, world!"
```
