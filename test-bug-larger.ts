// Test to specifically trigger the state management bug with larger payloads
import { WebSocketServer } from "ws";
import { randomBytes, randomUUID } from "crypto";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const LOCAL_PORT = 6669;

const wss = new WebSocketServer({
  port: LOCAL_PORT,
});

let messageCount = 0;
const receivedIds = new Set<string>();

wss.on("connection", (ws) => {
  console.log("server: client connected");

  const sendData = (megabytes: number) => {
    const payload = {
      id: randomUUID(),
      data: randomBytes(1024 * 1024 * megabytes).toString("base64"),
    };

    ws.send(JSON.stringify(payload));
    console.log(`server: sent ${megabytes} MB (${payload.id})`);
    return payload.id;
  };

  // Send larger messages to trigger the buffering/fragmentation logic
  const id1 = sendData(15); // 15 MB
  const id2 = sendData(10); // 10 MB
  
  setTimeout(() => {
    console.log(`Expected 2 messages, received ${messageCount} total, ${receivedIds.size} unique`);
    if (messageCount > receivedIds.size) {
      console.log("❌ BUG DETECTED: Message repetition occurred");
      process.exit(1);
    } else {
      console.log("✅ No repetition detected");  
      process.exit(0);
    }
  }, 15000); // Longer timeout for larger messages
});

wss.on("listening", () => {
  console.log(`server: listening on port ${LOCAL_PORT}`);
});

await sleep(1000);

const ws = new WebSocket(`ws://localhost:${LOCAL_PORT}`);

ws.addEventListener("message", (event) => {
  messageCount++;
  const parsed = JSON.parse(event.data.toString());
  const messageId = parsed.id;
  
  console.log(`client: received message ${messageCount}: ${messageId}`);
  
  if (receivedIds.has(messageId)) {
    console.log("❌ DUPLICATE MESSAGE DETECTED:", messageId);
  }
  
  receivedIds.add(messageId);
});