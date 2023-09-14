const http = require("http").createServer();

const io = require("socket.io")(http);
const port = process.env.PORT || 3000;
io.on("connection", socket => {
  socket.on("client to server event", msg => {
    io.emit("server to client event", msg);
  });
});

http.listen(port, () => {
  console.log(`Socket.IO server running at http://localhost:${port}/`);
});
