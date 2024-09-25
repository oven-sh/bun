type OS = "Windows";

Bun.serve({
  fetch(req: Request) {
    return new Response(`Hello, ${"Windows" as OS}!`);
  },
});
