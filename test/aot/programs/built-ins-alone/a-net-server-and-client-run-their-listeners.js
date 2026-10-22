import { connect, createServer } from "node:net";
const server = createServer(function (socket) {
  console.log(this === server, typeof socket.remotePort, arguments.length);
  socket.on("data", chunk => {
    console.log(chunk instanceof Buffer, chunk.toString());
    socket.end("pong");
  });
});
server.listen(0, () => {
  const client = connect(server.address().port, () => client.write("ping"));
  client.on("data", chunk => console.log(chunk.toString()));
  client.on("close", hadError => {
    console.log(hadError);
    server.close();
  });
});
