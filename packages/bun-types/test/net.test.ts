import * as net from "node:net";

const socket = net.connect({
  port: 80,
  host: "localhost",
});

socket.connect({
  port: 80,
  host: "localhost",
});
