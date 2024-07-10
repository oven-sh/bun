import { WebSocket, WebSocketServer } from "ws";

const ws = new WebSocket("ws://www.host.com/path");

ws.send("asdf");

const wss = new WebSocketServer({
  port: 8080,
  perMessageDeflate: false,
});
wss;
