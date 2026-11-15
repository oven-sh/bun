// A list without a constructor is printed with what it holds: the getters of the server run.
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("made up") });
try {
  queueMicrotask(Object.setPrototypeOf([server], null));
} catch (error) {
  console.log(`${error.code} ${error.message.includes("pendingRequests")} ${error.message.includes("URL")}`);
}
process.exit(0);
