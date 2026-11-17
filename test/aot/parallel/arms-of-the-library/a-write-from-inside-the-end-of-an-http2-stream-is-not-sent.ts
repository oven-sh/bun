// The transport of a session writes to a stream from inside end(chunk), once or twice, with the stream corked or not. The last frame waits for the window. Nothing follows it, and both sides close.
import { once } from "node:events";
import http2 from "node:http2";
import net from "node:net";
import { Duplex } from "node:stream";
const server = http2.createServer();
await once(server.listen(0, "127.0.0.1"), "listening");
for (const corked of [false, true]) {
  for (const times of [1, 2]) {
    let left = times;
    const socket = net.connect((server.address() as net.AddressInfo).port, "127.0.0.1");
    const transport = new Duplex({
      read() {},
      write(chunk, encoding, done) {
        socket.write(chunk);
        for (; chunk.length > 1000 && left > 0; left--) request.write("late");
        done();
      },
    });
    socket.on("data", chunk => transport.push(chunk));
    const client = http2.connect("http://origin", { createConnection: () => transport });
    const request = client.request({ ":method": "POST" });
    const response: http2.ServerHttp2Stream = (await once(server, "stream"))[0];
    let received = 0;
    response.on("data", chunk => (received += chunk.length));
    response.on("end", () => response.session!.ping(() => response.respond({}, { endStream: true })));
    if (corked) {
      request.cork();
      request.write("a");
    }
    request.resume().end(Buffer.alloc(70000));
    await Promise.all([once(request, "finish"), once(request, "close"), once(response, "close")]);
    console.log(corked, times, left, received, request.rstCode, response.rstCode);
    client.destroy();
    socket.destroy();
  }
}
server.close();
