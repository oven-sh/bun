// Writes to the socket that an 'upgrade' listener of node:http gets, several of them in one task, the way a server
// that speaks its own protocol over it sends a run of frames. A round ends when the client has read every byte.
import { once } from "node:events";
import http from "node:http";
import net from "node:net";
import { bench, run } from "../runner.mjs";

const server = http.createServer();
const upgraded = once(server, "upgrade");
await once(server.listen(0, "127.0.0.1"), "listening");

const client = net.connect(server.address().port, "127.0.0.1");
client.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: raw\r\n\r\n");
const [, socket] = await upgraded;

let missing = 0;
let done;
client.on("data", chunk => {
  if ((missing -= chunk.length) === 0) done();
});

function callback() {}

// The large ones first: the rounds of the small ones leave a heap behind that depends on how many of them ran.
for (const [count, size, cb] of [
  [2, 256 * 1024],
  [16, 48 * 1024],
  [16, 32 * 1024],
  [16, 16 * 1024],
  [16, 1024],
  [1, 128],
  [2, 128],
  [16, 128],
  [64, 128],
  [256, 128],
  [64, 128, callback],
]) {
  const chunk = Buffer.alloc(size, "x");
  bench(`${count} x write(${size} B${cb ? ", callback" : ""})`, () => {
    const { promise, resolve } = Promise.withResolvers();
    missing = count * size;
    done = resolve;
    for (let i = 0; i < count; i++) socket.write(chunk, cb);
    return promise;
  });
}

await run();
client.destroy();
server.close();
