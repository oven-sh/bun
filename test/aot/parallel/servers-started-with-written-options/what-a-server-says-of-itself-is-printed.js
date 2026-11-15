// Every server's first line prints what the server says of itself. Bun.serve answers one of four classes; each getter is looked up on each of them, answers a number, a text, a boolean or undefined, and the formatter is handed no object: nothing of the printer of objects comes into the executable.
// STATISTIC: ImageFunctionsEmitted <= 8
const server = Bun.serve({ port: 0, fetch(request) { return new Response("x"); } });
console.log("listening", typeof server.port, server.port > 0, server.development, server.pendingRequests, server.pendingWebSockets, server.protocol);
console.log(server.hostname, server.id);
server.stop();
