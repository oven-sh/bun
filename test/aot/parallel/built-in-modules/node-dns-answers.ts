import { AsyncLocalStorage } from "node:async_hooks";
import { createSocket } from "node:dgram";
import dns from "node:dns";
import { once } from "node:events";
import { promisify } from "node:util";

const data: Record<number, number[]> = {
  1: [10, 0, 0, 1],
  15: [0, 5, 1, 109, 0],
  16: [2, 104, 105, 1, 0xe9],
  33: [0, 1, 0, 2, 0, 3, 1, 115, 0],
  52: [3, 1, 1, 7, 8],
  257: [0, 5, ...Buffer.from("issueca")],
};
const server = createSocket("udp4", (query, from) => {
  let end = 12;
  while (query[end]) end += query[end] + 1;
  if (query[13] === "s".charCodeAt(0)) return;
  const type = query.readUInt16BE(end + 1);
  const bytes = data[type];
  const record = bytes ? [0xc0, 12, type >> 8, type & 255, 0, 1, 0, 0, 0, 0, 0, bytes.length, ...bytes] : [];
  const reply = Buffer.concat([query.subarray(0, end + 5), Buffer.from(record)]);
  reply.writeUInt16BE(bytes ? 0x8180 : 0x8183, 2);
  reply.writeUInt16BE(bytes ? 1 : 0, 6);
  server.send(reply, from.port, from.address);
});
await once(server.bind(0, "127.0.0.1"), "listening");
const servers = [`127.0.0.1:${server.address().port}`];

const shown = (promise: Promise<unknown>) =>
  promise.then(
    value => value,
    ({ code, errno, syscall, hostname, message }) => ({ code, errno, syscall, hostname, message }),
  );

const withPromises = new dns.promises.Resolver();
withPromises.setServers(servers);
console.log(await shown(withPromises.resolve4("a.test")));
console.log(await shown(withPromises.resolve4("a.test", { ttl: true })));
console.log(await shown(withPromises.resolveMx("a.test")));
console.log(await shown(withPromises.resolveTxt("a.test")));
console.log(await shown(withPromises.resolveSrv("a.test")));
console.log(await shown(withPromises.resolveCaa("a.test")));
console.log((await withPromises.resolveTlsa("a.test")).map(it => [it.certUsage, ...new Uint8Array(it.data)]));
console.log(await shown(withPromises.resolveNs("a.test")));
console.log(await shown(withPromises.resolve4("a..test")));
console.log(await shown(withPromises.reverse("a")));

const withCallbacks = new dns.Resolver();
withCallbacks.setServers(servers);
const storage = new AsyncLocalStorage<string>();
await new Promise<void>(resolve => {
  storage.run("kept", () =>
    withCallbacks.resolve("a.test", "MX", (err, records) => {
      console.log(err, records[0].exchange, records[0].priority, storage.getStore());
      resolve();
    }),
  );
});
await new Promise<void>(resolve => {
  withCallbacks.resolve4("silent.test", err => {
    console.log(err?.code, err?.message);
    resolve();
  });
  withCallbacks.cancel();
});

dns.setServers(servers);
console.log(dns.getServers().length, await shown(promisify(dns.resolve4)("a.test")));
console.log(await shown(promisify(dns.lookup)("localhost", 4)));
console.log(await shown(dns.promises.lookup("localhost", { family: 4, all: true })));
console.log(await shown(dns.promises.lookup("a..test")));
console.log(await shown(dns.promises.lookupService("127.0.0.1", 0)));
server.close();
