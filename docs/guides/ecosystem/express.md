---
name: Build an HTTP server using Express and Bun
---

Express and other major Node.js HTTP libraries should work out of the box. Bun implements the [`node:http`](https://nodejs.org/api/http.html) and [`node:https`](https://nodejs.org/api/https.html) modules that these libraries rely on.

{% callout %}
Refer to the [Runtime > Node.js APIs](https://bun.sh/docs/runtime/nodejs-apis#node-http) page for more detailed compatibility information.
{% /callout %}

```sh
$ bun add express
```

---

To define a simple HTTP route and start a server with Express:

```ts#server.ts
import express from "express";

const app = express();
const port = 8080;

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(port, () => {
  console.log(`Listening on port ${port}...`);
});
```

---

To start the server on `localhost`:

```sh
$ bun server.ts
```
