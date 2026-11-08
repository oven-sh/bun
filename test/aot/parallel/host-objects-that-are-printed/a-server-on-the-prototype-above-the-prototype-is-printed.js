// Two constructor functions, one below the other.
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("made up") });
function Place() {}
function Town() {}
Object.setPrototypeOf(Town.prototype, Place.prototype);
Place.prototype.held = server;
console.log(Bun.inspect(new Town()).includes("pendingRequests"));
process.exit(0);
