import Boom from "@hapi/boom";
import Hapi from "@hapi/hapi";
import Joi from "joi";

const server = Hapi.server({ port: 0, host: "127.0.0.1" });
server.ext("onPreResponse", (request, h) => {
  const response = request.response;
  if (!Boom.isBoom(response)) response.header("x-ext", request.path);
  return h.continue;
});
server.route({ method: "GET", path: "/person/{id}", options: { validate: { params: Joi.object({ id: Joi.number().integer().min(1).required() }) } }, handler: request => ({ id: request.params.id as number, doubled: (request.params.id as number) * 2 }) });
server.route({ method: "POST", path: "/sum", options: { validate: { payload: Joi.object({ numbers: Joi.array().items(Joi.number()).required() }) } }, handler: (request, h) => h.response({ sum: (request.payload as { numbers: number[] }).numbers.reduce((a, b) => a + b, 0) }).code(201) });
server.route({ method: "GET", path: "/teapot", handler: () => { throw Boom.teapot("short and stout"); } });
server.decorate("toolkit", "shout", function (this: Hapi.ResponseToolkit, text: string) { return this.response(text.toUpperCase()).type("text/plain"); });
server.route({ method: "GET", path: "/shout", handler: (_request, h) => (h as Hapi.ResponseToolkit & { shout(text: string): Hapi.ResponseObject }).shout("decorated") });
await server.start();
const base = server.info.uri;
for (const [path, init] of [["/person/21"], ["/person/abc"], ["/sum", { method: "POST", body: JSON.stringify({ numbers: [1, 2, 3] }), headers: { "content-type": "application/json" } }], ["/sum", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }], ["/teapot"], ["/shout"], ["/nowhere"]] as [string, RequestInit?][]) {
  const response = await fetch(base + path, init);
  console.log(path, response.status, response.headers.get("x-ext"), await response.text());
}
const injected = await server.inject({ method: "GET", url: "/person/4" });
console.log(injected.statusCode, injected.payload);
await server.stop();
console.log("DONE");
