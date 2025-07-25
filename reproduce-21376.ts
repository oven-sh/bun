import { WebSocketServer } from "ws";
import { randomBytes, randomUUID } from "crypto";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const LOCAL_PORT = 6666;

const wss = new WebSocketServer({
  port: LOCAL_PORT,
});

wss.on("connection", (ws) => {
  console.log("server: client connected");

  ws.on("close", () => {
    console.log("server: client disconnected");
  });

  const sendData = (megabytes: number = 10) => {
    const payload = {
      id: randomUUID(),
      data: randomBytes(1024 * 1024 * megabytes).toString("base64"),
    };

    ws.send(JSON.stringify(payload));

    console.log(`server: sent ${megabytes} MB (${payload.id}) ${Date.now()}`);
  };

  sendData(50); // send 50 MB to client
  sendData(5); // send 5 MB to client
});

wss.on("listening", () => {
  console.log(`server: listening on port ${LOCAL_PORT}`);
});

await sleep(1000); // just to make sure the server is ready

const ws = new WebSocket(`ws://localhost:${LOCAL_PORT}`);

ws.addEventListener("open", () => {
  console.log("client: connected to server");
});

ws.addEventListener("message", (event) => {
  const parsed = JSON.parse(event.data.toString());

  const messageInMb =
    Buffer.byteLength(event.data.toString(), "utf8") / (1024 * 1024); // aproximate size in MB

  console.log(
    `client: received ${parsed.id} (${messageInMb.toFixed(2)} MB) ${Date.now()}`
  );
});