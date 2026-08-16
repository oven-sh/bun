// `AWSClient.prototype.eventStream`. Stateless, so any receiver works.
export function eventStream(this: unknown, source: unknown) {
  return require("internal/aws/eventstream")(source);
}
