---
name: Start a cluster of HTTP servers
description: Run multiple HTTP servers concurrently via the "reusePort" option to share the same port across multiple processes
---

To run multiple HTTP servers concurrently, use the `reusePort` option in `Bun.serve()` which shares the same port across multiple processes.

This automatically load balances incoming requests across multiple instances of Bun.

```ts#server.ts
import { serve } from "bun";

const id = Math.random().toString(36).slice(2);

serve({
  port: process.env.PORT || 8080,
  development: false,

  // Share the same port across multiple processes
  // This is the important part!
  reusePort: true,

  async fetch(request) {
    return new Response("Hello from Bun #" + id + "!\n");
  }
});
```

---

{% callout %}
**Linux only** &mdash; Windows and macOS ignore the `reusePort` option. This is an operating system limitation with `SO_REUSEPORT`, unfortunately.
{% /callout %}

After saving the file, start your servers on the same port.

Under the hood, this uses the Linux `SO_REUSEPORT` and `SO_REUSEADDR` socket options to ensure fair load balancing across multiple processes. [Learn more about `SO_REUSEPORT` and `SO_REUSEADDR`](https://lwn.net/Articles/542629/)

```ts#cluster.ts
import { spawn } from "bun";

const cpus = navigator.hardwareConcurrency; // Number of CPU cores
const buns = new Array(cpus);

for (let i = 0; i < cpus; i++) {
  buns[i] = spawn({
    cmd: ["bun", "./server.ts"],
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
}

function kill() {
  for (const bun of buns) {
    bun.kill();
  }
}

process.on("SIGINT", kill);
process.on("exit", kill);
```

---

At the time of writing, Bun hasn't implemented the `node:cluster` module yet, but this is a faster, simple, and limited alternative. We will also implement `node:cluster` in the future.
