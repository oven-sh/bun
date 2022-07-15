import { Hono } from "hono";

const app = new Hono();

const port = parseInt(process.env.PORT) || 3000;

const home = app.get("/", (c) => {
  return c.json({ message: "Hello World!" });
});

console.log(`Running at http://localhost:${port}`);

export default {
  port,
  fetch: home.fetch,
};
