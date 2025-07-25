import { WebSocketServer } from "ws";
import { randomBytes, randomUUID } from "crypto";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const LOCAL_PORT = 6667;

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

  // Use smaller payloads to avoid crash but still trigger the repetition bug
  sendData(2); // send 2 MB to client
  sendData(1); // send 1 MB to client
});

wss.on("listening", () => {
  console.log(`server: listening on port ${LOCAL_PORT}`);
});

await sleep(1000); // just to make sure the server is ready

const ws = new WebSocket(`ws://localhost:${LOCAL_PORT}`);

const receivedMessages = new Set<string>();
let messageCount = 0;

ws.addEventListener("open", () => {
  console.log("client: connected to server");
});

ws.addEventListener("message", (event) => {
  messageCount++;
  const parsed = JSON.parse(event.data.toString());

  const messageInMb =
    Buffer.byteLength(event.data.toString(), "utf8") / (1024 * 1024); // aproximate size in MB

  console.log(
    `client: received ${parsed.id} (${messageInMb.toFixed(2)} MB) ${Date.now()} [count: ${messageCount}]`
  );
  
  if (receivedMessages.has(parsed.id)) {
    console.error(`ERROR: Duplicate message received: ${parsed.id}`);
    process.exit(1);  
  }
  
  receivedMessages.add(parsed.id);
  
  // Expected 2 unique messages
  if (receivedMessages.size === 2) {
    console.log("SUCCESS: All messages received without duplication");
    process.exit(0);
  }
});

// Timeout after 10 seconds
setTimeout(() => {
  console.log(`TIMEOUT: Received ${receivedMessages.size} unique messages out of 2 expected (${messageCount} total)`);
  process.exit(1);
}, 10000);