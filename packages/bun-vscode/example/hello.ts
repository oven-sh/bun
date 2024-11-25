import * as os from "node:os";

Bun.serve({
  fetch(req: Request) {
    return new Response(`Hello from ${os.arch()}!`);
  },
});
