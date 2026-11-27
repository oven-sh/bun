// A class without a name has instances that are named after the first class above it that has one. Nothing that they hold is printed.
class Named {}
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("made up") });
const heirOf = Base => class extends Base {};
globalThis.held = [
  new (heirOf(Map))([[1, server]]),
  heirOf(Array).from([server]),
  new (heirOf(URL))("http://example.com/"),
  new (heirOf(Named))(),
  Object.assign(new (heirOf(heirOf(Named)))(), { server }),
  new Proxy(Object.assign(new (class {})(), { server }), {}),
  Object.create(heirOf(URL).prototype),
  heirOf(ReadableStream).prototype,
];
globalThis.refuse = queueMicrotask;
for (const held of globalThis.held) {
  try {
    globalThis[JSON.parse('"refuse"')](held);
  } catch (error) {
    console.log(error.message);
  }
}
process.exit(0);
