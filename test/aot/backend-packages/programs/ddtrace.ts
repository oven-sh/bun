import tracer from "dd-trace";
import type { AddressInfo } from "node:net";

const bodies: string[] = [];
const agent = Bun.serve({
  hostname: "127.0.0.1", port: 0,
  async fetch(request) {
    if (new URL(request.url).pathname.endsWith("/traces")) bodies.push(Buffer.from(await request.arrayBuffer()).toString("latin1"));
    return Response.json({ rate_by_service: {} });
  },
});
process.env.DD_INSTRUMENTATION_TELEMETRY_ENABLED = "false";
process.env.DD_REMOTE_CONFIGURATION_ENABLED = "false";
process.env.DD_TRACE_STARTUP_LOGS = "false";
tracer.init({ service: "smoke", url: `http://127.0.0.1:${agent.port}`, flushInterval: 50, runtimeMetrics: false, logInjection: false });

const http: typeof import("node:http") = require("node:http");
const express: typeof import("express") = require("express");
const app = express();
app.get("/person/:id", (request, response) => { response.json({ id: request.params.id, traced: tracer.scope().active() !== null }); });
const server = http.createServer(app);
const port = await new Promise<number>(resolve => server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));

console.log(tracer.trace("manual.work", { resource: "r" }, () => 41 + 1));
console.log(await new Promise<string>(resolve => http.get({ host: "127.0.0.1", port, path: "/person/7" }, response => {
  let all = "";
  response.on("data", chunk => (all += chunk));
  response.on("end", () => resolve(all));
})));
await new Promise<void>(resolve => server.close(() => resolve()));
await new Promise(resolve => setTimeout(resolve, 700));
const all = bodies.join("");
console.log(["manual.work", "express.request", "express.middleware", "web.request", "http.request"].map(name => name + " " + all.includes(name)).join(" | "));
agent.stop(true);
console.log("DONE");
process.exit(0);
