---
name: Send an HTTP request using fetch
---

Bun implements the Web-standard [`fetch`](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API) API for sending HTTP requests. To send a simple `GET` request to a URL:

```ts
const response = await fetch("https://bun.com");
const html = await response.text(); // HTML string
```

---

To send a `POST` request to an API endpoint.

```ts
const response = await fetch("https://bun.com/api", {
  method: "POST",
  body: JSON.stringify({ message: "Hello from Bun!" }),
  headers: { "Content-Type": "application/json" },
});

const body = await response.json();
```
