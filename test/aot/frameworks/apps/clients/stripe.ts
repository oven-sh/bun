import Stripe from "stripe";

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const form = new URLSearchParams(await request.text());
    return Response.json(
      { id: "cus_1", object: "customer", email: form.get("email"), metadata: {} },
      { headers: { "request-id": "req_1" } },
    );
  },
});
const stripe = new Stripe("sk_test_123", {
  host: "localhost",
  port: server.port,
  protocol: "http",
  maxNetworkRetries: 0,
  telemetry: false,
});
const customer = await stripe.customers.create({ email: "customer@example.com" });
console.log(customer.id, customer.email, customer.lastResponse.requestId);
server.stop(true);

const payload = JSON.stringify({ id: "evt_1", object: "event", type: "payment_intent.succeeded" });
const header = await stripe.webhooks.generateTestHeaderStringAsync({
  payload,
  secret: "whsec_test",
  timestamp: 1700000000,
});
console.log(header);
const event: Stripe.Event = await stripe.webhooks.constructEventAsync(
  payload,
  header,
  "whsec_test",
  Number.MAX_SAFE_INTEGER,
);
console.log(event.type);
try {
  await stripe.webhooks.constructEventAsync(payload, header, "whsec_other", Number.MAX_SAFE_INTEGER);
} catch (error) {
  console.log(error instanceof Stripe.errors.StripeSignatureVerificationError, (error as Error).name);
}
