import { Elysia } from "elysia";
import { makeCache, handle } from "./shared.js";
const cache = makeCache();
const app = new Elysia()
  .get("/api/:id", ({ params, query }) => handle(cache, params.id, query))
  .listen(0);
process.stderr.write(`LISTEN ${app.server!.port}\n`);
