---
name: Encode and decode base64 strings
---

Bun implements the `Buffer` API from Node which can be used for encoding and decoding strings.

```ts
const data = "hello world";
const encoded = Buffer.from(data, "utf-8").toString("base64"); // => "aGVsbG8gd29ybGQ="
const decoded = Buffer.from(encoded, "base64").toString("utf-8"); // => "hello world"
```

See [Docs > Binary Data](https://bun.sh/docs/api/binary-data#buffer) for a complete breakdown of the Buffer API.

---

Bun also implements the Web-standard [`atob`](https://developer.mozilla.org/en-US/docs/Web/API/WindowOrWorkerGlobalScope/atob) and [`btoa`](https://developer.mozilla.org/en-US/docs/Web/API/WindowOrWorkerGlobalScope/btoa) functions for encoding and decoding base64 strings.

These functions should be used if targetting the DOM/browser, `Buffer` is not available in these contexts.

```ts
const data = "hello world";
const encoded = btoa(data); // => "aGVsbG8gd29ybGQ="
const decoded = atob(encoded); // => "hello world"
```

See [Docs > Web APIs](https://bun.sh/docs/runtime/web-apis) for a complete breakdown of the Web APIs implemented in Bun.

---
