// A default export with a stop method is a server, not a configuration: no server starts.
console.debug = (message: unknown) => console.log("debug " + String(message).replace(/:\d+$/, ":PORT"));
setTimeout(() => { console.log("no server"); process.exit(0); }, 50);
export default { port: 0, fetch() { return new Response("ok"); }, stop() {} };
