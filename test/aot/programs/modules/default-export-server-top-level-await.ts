// An entry module with top-level await starts the server of its default export once, after its evaluation finishes.
console.debug = (message: unknown) => console.log("debug " + String(message).replace(/:\d+$/, ":PORT"));
await Promise.resolve();
setTimeout(() => process.exit(0), 50);
export default { port: 0, fetch() { return new Response("ok"); } };
