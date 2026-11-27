// CPU time of the resolver behind dns.resolve*(), against a server in another process.
import { fork } from "node:child_process";
import dgram from "node:dgram";
import dns from "node:dns";
import { once } from "node:events";
import net from "node:net";

// `<count>-<ttl>-anything.test` has `count` records of each type.
function reply(query, limit) {
  let end = 12;
  while (query[end]) end += query[end] + 1;
  const type = query.readUInt16BE(end + 1);
  const [count, ttl] = type === 12 ? [1, 0] : query.toString("latin1", 13, end).split("-").map(Number);
  const host = [4, 104, 111, 115, 116, 0xc0, 12];
  const records = Array.from({ length: count }, (_, i) => {
    const data = {
      1: [127, 1, i >> 8, i],
      15: [0, i, ...host],
      16: [255, ...Buffer.alloc(255, "a")],
      28: [0x20, 1, 0x0d, 0xb8, ...Buffer.alloc(11), i + 1],
      33: [0, 1, 0, 1, 0, 1, 1, 97, 0],
    };
    const bytes = data[type] ?? host;
    return Buffer.from([0xc0, 12, 0, type, 0, 1, 0, 0, ttl >> 8, ttl, bytes.length >> 8, bytes.length, ...bytes]);
  });
  const message = Buffer.concat([query.subarray(0, end + 5), ...records]);
  const fits = message.length <= limit;
  message.writeUInt16BE(fits ? 0x8180 : 0x8380, 2);
  message.writeUInt16BE(fits ? count : 0, 6);
  return fits ? message : message.subarray(0, end + 5);
}

if (process.argv[2] === "server") {
  const tcp = net.createServer({ noDelay: true }, socket => {
    let input = Buffer.alloc(0);
    socket.on("error", () => {});
    socket.on("data", chunk => {
      input = Buffer.concat([input, chunk]);
      while (input.length >= 2 && input.length >= 2 + input.readUInt16BE(0)) {
        const end = 2 + input.readUInt16BE(0);
        const message = reply(input.subarray(2, end), 65535);
        socket.write(Buffer.concat([Buffer.from([message.length >> 8, message.length]), message]));
        input = input.subarray(end);
      }
    });
  });
  await once(tcp.listen(0, "127.0.0.1"), "listening");
  const udp = dgram.createSocket("udp4");
  udp.on("message", (query, { port, address }) => udp.send(reply(query, 512), port, address));
  await once(udp.bind(tcp.address().port, "127.0.0.1"), "listening");
  process.on("disconnect", process.exit);
  process.send(tcp.address().port);
} else {
  const server = fork(import.meta.filename, ["server"]);
  const servers = [`127.0.0.1:${(await once(server, "message"))[0]}`];
  dns.setServers(servers);
  const { promises } = dns;
  const lookup = globalThis.Bun && (name => Bun.dns.lookup(name, { backend: "c-ares" }));

  // calls, how many at once, the call
  const cases = {
    "resolve4": [10_000, 1, i => promises.resolve4(`1-0-${i}.test`)],
    "resolve4 x100": [50_000, 100, i => promises.resolve4(`1-0-${i}.test`)],
    "resolve4 x100, goes in the cache": [50_000, 100, i => promises.resolve4(`1-60-${i}.test`)],
    "resolve4, cached": [100_000, 1, () => promises.resolve4("1-3600-.test")],
    "resolve4, 16 addresses, cached": [100_000, 100, i => promises.resolve4(`16-3600-${i % 100}.test`)],
    "resolve4 x16, 100 addresses, TCP": [4_000, 16, i => promises.resolve4(`100-0-${i}.test`)],
    "resolve6 x100, 8 addresses": [30_000, 100, i => promises.resolve6(`8-0-${i}.test`)],
    "resolveMx x100, 8 records": [30_000, 100, i => promises.resolveMx(`8-0-${i}.test`)],
    "resolveSrv, 8 records, cached": [100_000, 100, i => promises.resolveSrv(`8-3600-${i % 100}.test`)],
    "resolveTxt, 50 KB, TCP": [1_000, 1, i => promises.resolveTxt(`200-0-${i}.test`)],
    "reverse x100": [30_000, 100, i => promises.reverse(`10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`)],
    "lookupService, hosts file": [50_000, 1, () => promises.lookupService("127.0.0.1", 80)],
    "new Resolver": [10_000, 1, () => new dns.Resolver().setServers(servers)],
    "SocketAddress.parse": [500_000, 1000, i => net.SocketAddress.parse(`[2001:db8::${i & 0xfff}]:80`).address],
    ...(lookup && {
      "Bun.dns.lookup, 2 addresses": [10_000, 1, i => lookup(`1-0-${i}.test`)],
      "Bun.dns.lookup x50, 8 addresses": [10_000, 50, i => lookup(`4-0-${i}.test`)],
      "Bun.dns.lookup, 8 addresses, cached": [10_000, 50, i => lookup(`4-3600-${i % 50}.test`)],
    }),
  };

  let next = 0;
  for (const [name, [calls, width, call]] of Object.entries(cases)) {
    let best = Infinity;
    for (let round = 0; round < 6; round++) {
      const start = process.cpuUsage();
      for (let done = 0; done < calls; done += width) {
        await Promise.all(Array.from({ length: width }, () => call(next++)));
      }
      const { user, system } = process.cpuUsage(start);
      best = Math.min(best, (user + system) / calls);
    }
    console.log(name.padEnd(40), best.toFixed(2).padStart(8), "µs");
  }
  server.disconnect();
}
