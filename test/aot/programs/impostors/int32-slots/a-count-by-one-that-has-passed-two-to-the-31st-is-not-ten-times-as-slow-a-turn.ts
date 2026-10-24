// A long-lived object counts what it has served, one at a time. One day the count no longer fits 32 bits. From then on a turn may cost a few times what it cost before, not ten times.
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
function fastestOf(runs: number, server: Server) {
  let fastest = Infinity;
  for (let run = 0; run < runs; run++) {
    const began = performance.now();
    serveMany(server, 2_000_000);
    fastest = Math.min(fastest, performance.now() - began);
  }
  return fastest;
}
const server = new Server();
const small = fastestOf(5, server);
Reflect.set(server, "served", 2 ** 31 - 1000);
const large = fastestOf(5, server);
console.log(server.served, server.open, Object.keys(server).join());
console.log(large < small * 10 ? "a turn past 2 ** 31 takes under ten times the time" : "a turn past 2 ** 31 takes over ten times the time");
