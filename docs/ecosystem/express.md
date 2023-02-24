Projects that use Express other major Node.js HTTP libraries should work out of the box.

```ts
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

Bun implements the Node.js [`http`](https://nodejs.org/api/http.html) and [`https`](https://nodejs.org/api/https.html) modules that these libraries rely on. These modules can also be used directly, though [`Bun.serve`](/docs/api/http) is recommended for most use cases.

{% callout %}
**Note** — Refer to the [Runtime > Node.js APIs](/docs/runtime/nodejs#node_http) page for more detailed compatibility information.
{% /callout %}

```ts
import * as http from "node:http";

http
  .createServer(function (req, res) {
    res.write("Hello World!");
    res.end();
  })
  .listen(8080);
```
