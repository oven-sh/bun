import net from "node:net";

const events = [];
const server = net.createServer(socket => {
  socket.setEncoding("utf8");
  let pending = "";
  socket.on("data", text => {
    pending += text;
    let end;
    while ((end = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, end);
      pending = pending.slice(end + 1);
      if (line === "quit") socket.end("bye\n");
      else socket.write(line.split("").reverse().join("") + "\n");
    }
  });
  socket.on("end", () => events.push("server saw the end"));
  socket.on("close", hadError => events.push("server socket closed " + hadError));
});

server.on("listening", () => events.push("listening " + server.listening));
server.listen(0, "127.0.0.1", () => {
  const { port, family, address } = server.address();
  console.log(typeof port, family, address);
  const client = net.connect({ port, host: "127.0.0.1" });
  let received = "";
  client.on("connect", () => {
    console.log(client.remoteAddress, client.remotePort === port, client.remoteFamily, client.connecting, client.readyState);
    client.write("abc\nde");
    client.write("f\n");
    client.write(Buffer.from("quit\n"));
  });
  client.on("data", chunk => (received += chunk));
  client.on("close", () => {
    console.log(JSON.stringify(received), client.bytesWritten, client.bytesRead, client.destroyed);
    server.getConnections((error, count) => {
      console.log(error, count);
      server.close(() => {
        console.log(events.sort(), server.listening);
        net.connect(port, "127.0.0.1").on("error", error => console.log(error.code, error.syscall, net.isIP("127.0.0.1"), net.isIPv6("::1"), net.isIP("nope")));
      });
    });
  });
});
