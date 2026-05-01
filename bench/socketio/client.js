const { io } = require("socket.io-client");
const port = process.env.PORT || 3000;

const URL = `ws://localhost:${port}`;
const MAX_CLIENTS = 250;
const BATCHSIZE = MAX_CLIENTS / 10;
const BATCH_INTERVAL_IN_MS = 1000;
const EMIT_INTERVAL_IN_MS = 50;

let clientCount = 0;
let lastReport = new Date().getTime();
let packetsSinceLastReport = 0;

const clients = [];
const createClient = () => {
  const socket = io(URL);
  clients.push(socket);

  socket.on("server to client event", () => {
    packetsSinceLastReport++;
  });

  socket.on("disconnect", reason => {
    console.log(`disconnect due to ${reason}`);
  });
};

let emitInterval = null;

const createClients = () => {
  for (let i = 0; i < BATCHSIZE; i++) {
    createClient();
    clientCount++;
  }

  if (clientCount < MAX_CLIENTS) {
    setTimeout(createClients, BATCH_INTERVAL_IN_MS);
  }
  if (!emitInterval) {
    emitInterval = setInterval(() => {
      clients.forEach(socket => {
        socket.emit("client to server event", "hello world");
      });
    }, EMIT_INTERVAL_IN_MS);
  }
};

createClients();

const printReport = () => {
  const now = new Date().getTime();
  const durationSinceLastReport = (now - lastReport) / 1000;
  const packetsPerSeconds = (packetsSinceLastReport / durationSinceLastReport).toFixed(2);

  console.log(`client count: ${clientCount} ; average packets received per second: ${packetsPerSeconds}`);

  packetsSinceLastReport = 0;
  lastReport = now;
};

setInterval(printReport, 1000);
