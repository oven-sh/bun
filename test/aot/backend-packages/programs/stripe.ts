import http from "node:http";
import Stripe from "stripe";
import { listen, readBody } from "./lib_http.ts";

const seen: string[] = [];
const server = http.createServer(async (request, response) => {
  seen.push(`${request.method} ${request.url} ${request.headers.authorization} ${await readBody(request)}`);
  response.setHeader("Content-Type", "application/json");
  if (request.url!.includes("missing")) { response.statusCode = 404; response.end(JSON.stringify({ error: { type: "invalid_request_error", code: "resource_missing", message: "No such customer" } })); }
  else response.end(JSON.stringify({ id: "cus_1", object: "customer", email: "a@example.com", metadata: { plan: "pro" } }));
});
const port = await listen(server);
const stripe = new Stripe("sk_test_smoke", { host: "127.0.0.1", port, protocol: "http", maxNetworkRetries: 0, telemetry: false });
const customer = await stripe.customers.create({ email: "a@example.com", metadata: { plan: "pro" } });
console.log(customer.id, customer.email, customer.metadata.plan);
try { await stripe.customers.retrieve("missing"); } catch (error) { console.log(error instanceof Stripe.errors.StripeInvalidRequestError, (error as Stripe.errors.StripeError).code, (error as Stripe.errors.StripeError).statusCode); }
const payload = JSON.stringify({ id: "evt_1", object: "event", type: "customer.created" });
const header = await stripe.webhooks.generateTestHeaderStringAsync({ payload, secret: "whsec_smoke", timestamp: Math.floor(Date.now() / 1000) });
console.log((await stripe.webhooks.constructEventAsync(payload, header, "whsec_smoke")).type);
try { await stripe.webhooks.constructEventAsync(payload + " ", header, "whsec_smoke"); } catch (error) { console.log((error as Error).constructor.name); }
server.close();
console.log(seen.join("\n"));
console.log("DONE");
