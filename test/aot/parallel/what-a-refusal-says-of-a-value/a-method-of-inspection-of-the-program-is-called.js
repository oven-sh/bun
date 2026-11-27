// The program names the symbol and nothing else of util.inspect. What the method answers is described without what it holds.
const custom = Symbol.for("nodejs.util.inspect.custom");
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("made up") });
for (const held of [
  new (class { [custom](depth, options, inspect) { return `${depth} ${options.breakLength} ${inspect([1])}`; } })(),
  new (class extends URL { [custom]() { return "below URL"; } })("http://example.com/"),
  { __proto__: null, server, [custom]() { return this; } },
  { __proto__: null, [custom]: () => [server] },
  { __proto__: null, [custom]: () => server },
  { __proto__: null, get [custom]() { return () => "by a getter"; } },
  { __proto__: null, [custom]: (() => "bound").bind(null) },
  new Proxy({ __proto__: null, [custom]: () => "behind a proxy" }, {}),
]) {
  try {
    process.exitCode = held;
  } catch (error) {
    console.log(`${error.message}`);
  }
}
process.exit(0);
