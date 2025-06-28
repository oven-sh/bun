Projects that use Express and other major Node.js HTTP libraries should work out of the box.

{% callout %}
If you run into bugs, [please file an issue](https://bun.sh/issues) _in Bun's repo_, not the library. It is Bun's responsibility to address Node.js compatibility issues.
{% /callout %}

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

Bun implements the [`node:http`](https://nodejs.org/api/http.html) and [`node:https`](https://nodejs.org/api/https.html) modules that these libraries rely on. These modules can also be used directly, though [`Bun.serve`](https://bun.sh/docs/api/http) is recommended for most use cases.

{% callout %}
**Note** — Refer to the [Runtime > Node.js APIs](https://bun.sh/docs/runtime/nodejs-apis#node-http) page for more detailed compatibility information.
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
