---
name: Encode and decode base64 strings
---

Bun implements the Web-standard [`atob`](https://developer.mozilla.org/en-US/docs/Web/API/WindowOrWorkerGlobalScope/atob) and [`btoa`](https://developer.mozilla.org/en-US/docs/Web/API/WindowOrWorkerGlobalScope/btoa) functions for encoding and decoding base64 strings.

```ts
const data = "hello world";
const encoded = btoa(data); // => "aGVsbG8gd29ybGQ="
const decoded = atob(encoded); // => "hello world"
```

---

See [Docs > API > Hashing](/docs/api/hashing#bun-password) for complete documentation.
