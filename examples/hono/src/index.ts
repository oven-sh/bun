import { Hono } from "hono";
import { serveStatic } from 'hono/serve-static.bun';

const port = parseInt(process.env.PORT) || 3000;

const app = new Hono();

app.use('/favicon.ico', serveStatic({ path: './public/favicon.ico' }));

app.get("/", (c) => {
  return c.json({ message: "Hello World!" });
});

console.log(`Running at http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch
};
