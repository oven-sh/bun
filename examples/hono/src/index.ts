import { Hono } from "hono";

const port = parseInt(process.env.PORT) || 3000;

const app = new Hono();

app.get("/", (c) => {
  return c.json({ message: "Hello World!" });
});

console.log(`Running at http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch
};
