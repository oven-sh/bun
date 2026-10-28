import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import Fastify from "fastify";

const app = Fastify();
await app.register(helmet);
await app.register(cors, { origin: "https://example.test" });
await app.register(cookie, { secret: "a secret of the test" });
await app.register(jwt, { secret: "another secret" });
await app.register(multipart);
await app.register(rateLimit, { max: 3, timeWindow: "1 minute", keyGenerator: request => String(request.headers["x-who"] ?? "nobody") });
await app.register(swagger, { openapi: { info: { title: "smoke", version: "1.0.0" } } });
app.get("/token", async () => ({ parts: app.jwt.sign({ who: "ada" }, { noTimestamp: true }).split(".").length }));
app.get("/me", { onRequest: async request => { await request.jwtVerify(); } }, async request => request.user);
app.get("/cookie", async (request, reply) => reply.setCookie("who", "ada", { signed: true, path: "/" }).send({ had: request.cookies["who"] ?? null }));
app.post("/upload", async request => { const file = await request.file(); return { name: file?.filename, text: (await file?.toBuffer())?.toString() }; });
app.get("/person/:id", { schema: { params: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] }, response: { 200: { type: "object", properties: { id: { type: "integer" }, doubled: { type: "integer" } } } } } }, async request => { const { id } = request.params as { id: number }; return { id, doubled: id * 2, leftOut: true }; });
await app.ready();
const base = await app.listen({ port: 0, host: "127.0.0.1" });
const token = app.jwt.sign({ who: "ada" }, { noTimestamp: true });
const form = new FormData();
form.set("file", new File(["the text of a file"], "note.txt", { type: "text/plain" }));
for (const [path, init] of [["/token"], ["/me"], ["/me", { headers: { authorization: "Bearer " + token } }], ["/cookie"], ["/upload", { method: "POST", body: form }], ["/person/21"], ["/person/abc"], ["/person/1", { headers: { "x-who": "limited" } }], ["/person/2", { headers: { "x-who": "limited" } }], ["/person/3", { headers: { "x-who": "limited" } }], ["/person/4", { headers: { "x-who": "limited" } }]] as [string, RequestInit?][]) {
  const response = await fetch(base + path, { ...init, headers: { "x-who": path, origin: "https://example.test", ...init?.headers } });
  console.log(path, response.status, response.headers.get("access-control-allow-origin"), response.headers.get("x-frame-options"), response.headers.get("x-ratelimit-remaining"), (response.headers.get("set-cookie") ?? "-").split(".")[0], await response.text());
}
console.log(Object.keys((app.swagger() as { paths: Record<string, unknown> }).paths).sort().join());
await app.close();
console.log("DONE");
