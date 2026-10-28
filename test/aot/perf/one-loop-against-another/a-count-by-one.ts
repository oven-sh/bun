// A long-lived object counts what it has served, one at a time. One day the count no longer fits 32 bits.
class Server {
  served = 0;
  open = 0;
  serve() {
    this.served++;
    this.open = (this.open + 1) & 1023;
  }
}
function serveMany(server: Server, turns: number) {
  for (let turn = 0; turn < turns; turn++) server.serve();
}
const [loop = "past 2 ** 31", turns = "5000"] = process.argv.slice(2);
const server = new Server();
serveMany(server, 5000);
if (loop === "past 2 ** 31") Reflect.set(server, "served", 2 ** 31 - 1000);
serveMany(server, 5000);
serveMany(server, Number(turns));
console.log(server.served, server.open, Object.keys(server).join());
