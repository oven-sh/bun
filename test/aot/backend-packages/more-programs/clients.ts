import axios from "axios";
import got from "got";
import ky from "ky";
import http from "node:http";
import nodeFetch from "node-fetch";
import { request as undiciRequest } from "undici";
import { listen, readBody } from "./lib_http.ts";

const server = http.createServer(async (request, response) => {
  const body = await readBody(request);
  if (request.url === "/flaky" && !(server as { tried?: boolean }).tried) { (server as { tried?: boolean }).tried = true; response.statusCode = 503; response.end("later"); return; }
  if (request.url === "/missing") { response.statusCode = 404; response.end("no"); return; }
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify({ method: request.method, url: request.url, body, type: request.headers["content-type"] ?? null }));
});
const base = "http://127.0.0.1:" + (await listen(server));
const client = axios.create({ baseURL: base, headers: { "x-from": "axios" } });
client.interceptors.response.use(response => { (response.data as { seen?: boolean }).seen = true; return response; });
console.log(JSON.stringify((await client.post("/a?x=1", { n: 1 })).data), await client.get("/missing").catch((error: unknown) => (axios.isAxiosError(error) ? error.response?.status : "other")));
console.log(JSON.stringify(await got.post(base + "/b", { json: { n: 2 } }).json()), (await got(base + "/flaky", { retry: { limit: 2, backoffLimit: 1 } }).json<{ url: string }>()).url);
console.log(JSON.stringify(await ky.post(base + "/c", { json: { n: 3 } }).json()), await ky.get(base + "/missing").catch((error: Error) => error.name));
console.log(JSON.stringify(await (await nodeFetch(base + "/d", { method: "POST", body: "plain" })).json()));
const answered = await undiciRequest(base + "/e", { method: "PUT", body: "put" });
console.log(answered.statusCode, JSON.stringify(await answered.body.json()));
server.close();
server.closeAllConnections();
console.log("DONE");
