import { AngularNodeAppEngine, createNodeRequestHandler, isMainModule, writeResponseToNodeResponse } from "@angular/ssr/node";
import express from "express";
import { join } from "node:path";

const app = express();
const angular = new AngularNodeAppEngine();

app.use((request, response, next) => {
  response.setHeader("x-middleware-ran", request.path);
  next();
});
app.get("/old", (_request, response) => response.redirect(307, "/"));
app.get("/api/hello", (request, response) => response.json({ hello: request.query["name"] ?? "nobody" }));
app.post("/api/hello", express.json(), (request, response) => {
  const body = request.body as { numbers: number[] };
  response.status(201).setHeader("x-made-by", "route").json({ sum: body.numbers.reduce((a, b) => a + b, 0) });
});
app.get("/api/people", (_request, response) => response.json([{ id: 1, name: "ada" }, { id: 2, name: "grace" }]));
app.use(express.static(join(import.meta.dirname, "../browser"), { maxAge: "1y", index: false, redirect: false }));
app.use((request, response, next) => {
  angular.handle(request).then(rendered => (rendered ? writeResponseToNodeResponse(rendered, response) : next())).catch(next);
});

if (isMainModule(import.meta.url)) app.listen(Number(process.env["PORT"]), "127.0.0.1");

export const reqHandler = createNodeRequestHandler(app);
