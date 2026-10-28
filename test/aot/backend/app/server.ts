import { quoteOrder, showProduct } from "./shop/routes";
import { loadSessions } from "./shop/sessions";
import { db, fortunes, json, plaintext, queries, updates } from "./techempower";

await loadSessions();

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.PORT ?? 3000),
  reusePort: true,
  routes: {
    "/plaintext": plaintext,
    "/json": json,
    "/db": db,
    "/queries": queries,
    "/fortunes": fortunes,
    "/updates": updates,
    "/api/shops/:shop/products/:id": showProduct,
    "/api/shops/:shop/quotes": { POST: quoteOrder },
  },
  fetch() {
    return new Response("Not Found", { status: 404 });
  },
});

console.log("listening", server.port);
