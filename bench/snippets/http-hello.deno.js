var i = 0;
Deno.serve({
  port: parseInt(Deno.env.get("PORT") || "3000", 10),
  handler(req) {
    if (i++ === 200_000 - 1) queueMicrotask(() => Deno.exit(0));
    return new Response("Hello, World!" + i);
  },
});
