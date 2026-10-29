import * as Sentry from "@sentry/node";
import type { AddressInfo } from "node:net";

const seen: string[] = [];
Sentry.init({
  dsn: "http://public@127.0.0.1:9/1", tracesSampleRate: 1, release: "smoke@1", environment: "test",
  beforeSend(event) {
    const exception = event.exception?.values?.[0];
    const frames = exception?.stacktrace?.frames ?? [];
    seen.push("error " + exception?.type + ": " + exception?.value + " in " + frames[frames.length - 1]?.function + " tags " + JSON.stringify(event.tags ?? {}));
    return null;
  },
  beforeSendTransaction(event) { seen.push("transaction " + event.transaction + " spans " + (event.spans?.length ?? 0)); return null; },
});

const http: typeof import("node:http") = require("node:http");
function broken(): never { throw new RangeError("out of range"); }
try { broken(); } catch (error) { Sentry.withScope(scope => { scope.setTag("where", "smoke"); Sentry.captureException(error); }); }
console.log(Sentry.startSpan({ name: "manual", op: "work" }, () => 41 + 1));

const server = http.createServer((request, response) => { response.end("traced: " + (Sentry.getActiveSpan() !== undefined)); });
const port = await new Promise<number>(resolve => server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));
console.log(await new Promise<string>(resolve => http.get({ host: "127.0.0.1", port, path: "/hello" }, response => {
  let all = "";
  response.on("data", chunk => (all += chunk));
  response.on("end", () => resolve(all));
})));
await new Promise<void>(resolve => server.close(() => resolve()));
await Sentry.flush(2000);
console.log(seen.sort().join(" | "));
await Sentry.close(1000);
console.log("DONE");
process.exit(0);
