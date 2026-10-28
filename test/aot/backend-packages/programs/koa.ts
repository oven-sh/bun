import Koa from "koa";
import { listen } from "./lib_http.ts";
import http from "node:http";

const app = new Koa();
const order: string[] = [];
app.use(async (context, next) => { order.push("in"); await next(); order.push("out"); context.set("x-order", order.join()); });
app.use(async context => {
  if (context.path === "/boom") context.throw(418, "teapot");
  context.body = { path: context.path, query: context.query, method: context.method };
});
app.on("error", () => {});
const server = http.createServer(app.callback());
const port = await listen(server);
const good = await fetch(`http://127.0.0.1:${port}/a?b=1`);
console.log(good.status, good.headers.get("content-type"), good.headers.get("x-order"), await good.text());
const bad = await fetch(`http://127.0.0.1:${port}/boom`);
console.log(bad.status, await bad.text());
server.close();
console.log("DONE");
