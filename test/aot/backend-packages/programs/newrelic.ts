/// <reference path="./lib_ambient.d.ts" />
import type { AddressInfo } from "node:net";

process.env.NEW_RELIC_NO_CONFIG_FILE = "true";
process.env.NEW_RELIC_APP_NAME = "smoke";
process.env.NEW_RELIC_LICENSE_KEY = "0123456789012345678901234567890123456789";
process.env.NEW_RELIC_LOG_ENABLED = "false";
process.env.NEW_RELIC_NATIVE_METRICS_ENABLED = "false";
process.env.NEW_RELIC_HOST = "127.0.0.1";
process.env.NEW_RELIC_UTILIZATION_DETECT_AWS = "false";
process.env.NEW_RELIC_UTILIZATION_DETECT_GCP = "false";
process.env.NEW_RELIC_UTILIZATION_DETECT_AZURE = "false";
process.env.NEW_RELIC_UTILIZATION_DETECT_DOCKER = "false";
process.env.NEW_RELIC_UTILIZATION_DETECT_KUBERNETES = "false";
const newrelic: NewRelicForTheSmoke = require("newrelic");
const http: typeof import("node:http") = require("node:http");
const express: typeof import("express") = require("express");

const app = express();
app.get("/person/:id", (request, response) => {
  const metadata = newrelic.getTraceMetadata();
  response.json({ id: request.params.id, traced: typeof metadata.traceId === "string" && metadata.traceId.length > 0 });
});
const server = http.createServer(app);
const port = await new Promise<number>(resolve => server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));
console.log(await new Promise<string>(resolve => http.get({ host: "127.0.0.1", port, path: "/person/7" }, response => {
  let all = "";
  response.on("data", chunk => (all += chunk));
  response.on("end", () => resolve(all));
})));
console.log(await newrelic.startBackgroundTransaction("job", async () => typeof newrelic.getTransaction().end));
await new Promise<void>(resolve => server.close(() => resolve()));
console.log("DONE");
process.exit(0);
