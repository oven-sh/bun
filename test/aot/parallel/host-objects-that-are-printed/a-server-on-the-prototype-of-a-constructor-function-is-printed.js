// The formatter prints what lies on the prototypes of an object, five deep: the getters of the server run.
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("made up") });
function Place(label) {
  this.label = label;
}
Place.prototype.held = server;
console.log(Bun.inspect(new Place("here")).includes("pendingRequests"));
process.exit(0);
