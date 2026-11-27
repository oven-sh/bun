// A list without a constructor is named by its class: the getters of the server do not run.
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("made up") });
try {
  queueMicrotask(Object.setPrototypeOf([server], null));
} catch (error) {
  console.log(`${error.code} ${error.message}`);
}
process.exit(0);
