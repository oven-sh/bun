import dns from "node:dns";
import { lookup } from "node:dns/promises";
import net from "node:net";

console.log(await lookup("localhost", { family: 4 }), await lookup("127.0.0.1"), (await lookup("localhost", { all: true, family: 4 })).length > 0);
await new Promise(resolve => dns.lookup("127.0.0.1", (error, address, family) => resolve(console.log(error, address, family))));
console.log(await lookup("").catch(error => error.code ?? error.name), typeof dns.getServers().length, typeof dns.Resolver, dns.NOTFOUND, dns.getDefaultResultOrder?.());
try {
  dns.lookup(5, () => {});
} catch (error) {
  console.log(error.code);
}
console.log(net.isIP("10.0.0.1"), net.isIP("::ffff:10.0.0.1"), net.isIP("10.0.0.256"), net.isIPv4("1.2.3"), net.isIPv6("fe80::1%eth0"), net.isIP(""), net.isIP(5));
const blocked = new net.BlockList();
blocked.addAddress("10.0.0.5");
blocked.addRange("10.0.1.0", "10.0.1.9");
blocked.addSubnet("192.168.0.0", 16);
console.log(blocked.check("10.0.0.5"), blocked.check("10.0.0.6"), blocked.check("10.0.1.7"), blocked.check("192.168.44.1"), blocked.check("::1", "ipv6"), blocked.rules.length);
const address = new net.SocketAddress({ address: "127.0.0.1", port: 8080 });
console.log(address.address, address.port, address.family, net.SocketAddress.parse?.("127.0.0.1:99")?.port);
const server = net.createServer().listen(0, "127.0.0.1");
await new Promise(resolve => server.once("listening", resolve));
const second = net.createServer();
console.log(await new Promise(resolve => second.once("error", error => resolve([error.code, error.syscall, error.address, error.port === server.address().port])).listen(server.address().port, "127.0.0.1")));
server.close();
const timedOut = net.connect({ host: "127.0.0.1", port: 9, timeout: 50 });
console.log(await new Promise(resolve => timedOut.once("error", error => resolve(error.code)).once("timeout", () => resolve("timeout"))));
timedOut.destroy();
