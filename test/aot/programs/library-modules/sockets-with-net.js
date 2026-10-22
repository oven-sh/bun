// node:net: a server that echoes, a client, the order of the events on both sides, addresses, encodings, half-open ends, several clients, a port nobody listens on, a port that is taken, a socket path, a timeout, and the functions that classify addresses.
import net from "node:net";
import os from "node:os";
import path from "node:path";

const events = [];
const server = net.createServer(socket => {
  events.push("server: connection");
  socket.setEncoding("utf8");
  socket.on("data", text => socket.write("echo " + text));
  socket.on("end", () => { events.push("server: end"); socket.end("bye"); });
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const { port, address, family } = server.address();
console.log(address, family, port > 0, server.listening);

const client = net.connect({ port, host: "127.0.0.1" });
const received = [];
client.on("data", part => received.push(part.toString()));
await new Promise(resolve => client.on("connect", resolve));
console.log(client.remoteAddress, client.remotePort === port, client.remoteFamily, client.localPort > 0, client.connecting, client.readyState);
client.write("one");
await new Promise(resolve => client.once("data", resolve));
client.end();
console.log(await new Promise(resolve => client.on("close", hadError => resolve("closed " + hadError))), received.join("|"), client.destroyed, client.bytesWritten, client.bytesRead);
console.log(events.join(", "));

const answers = await Promise.all([1, 2, 3].map(n => new Promise(resolve => {
  const socket = net.createConnection(port, "127.0.0.1", () => socket.write("client " + n));
  socket.once("data", part => { resolve(part.toString()); socket.destroy(); });
})));
console.log(answers.join(", "), await new Promise(resolve => server.getConnections((error, count) => resolve(typeof count))));

const taken = net.createServer();
console.log(await new Promise(resolve => taken.on("error", error => resolve([error.code, error.syscall].join())).listen(port, "127.0.0.1")));
await new Promise(resolve => server.close(resolve));
console.log(await new Promise(resolve => net.connect(port, "127.0.0.1").on("error", error => resolve([error.code, error.syscall, error.port === port].join()))));

const socketPath = path.join(os.tmpdir(), "library-modules-" + process.pid + ".sock");
const local = net.createServer(socket => socket.end("over a path"));
await new Promise(resolve => local.listen(socketPath, resolve));
console.log(local.address() === socketPath, await new Promise(resolve => net.connect(socketPath).on("data", part => resolve(part.toString()))));
await new Promise(resolve => local.close(resolve));

const quiet = net.createServer(() => {});
await new Promise(resolve => quiet.listen(0, "127.0.0.1", resolve));
const idle = net.connect(quiet.address().port, "127.0.0.1");
idle.setTimeout(5);
console.log(await new Promise(resolve => idle.on("timeout", () => { idle.destroy(); resolve("timed out"); })));
quiet.close();
console.log(net.isIP("127.0.0.1"), net.isIP("::1"), net.isIP("nope"), net.isIPv4("1.2.3.4"), net.isIPv6("1.2.3.4"), new net.BlockList().check("1.1.1.1"), typeof net.SocketAddress);
