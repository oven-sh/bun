const env = "process" in globalThis ? process.env : "Deno" in globalThis ? Deno.env.toObject() : {};

const SERVER = env.SERVER || "ws://0.0.0.0:4001";
const WebSocket = globalThis.WebSocket || (await import("ws")).WebSocket;
const LOG_MESSAGES = env.LOG_MESSAGES === "1";
const CLIENTS_TO_WAIT_FOR = parseInt(env.CLIENTS_COUNT || "", 10) || 16;
const WORKERS = parseInt(env.WORKERS || "", 10) || 1;
const DELAY = 64;
const MESSAGES_TO_SEND = Array.from({ length: 32 }, () => [
  "Hello World!",
  "Hello World! 1",
  "Hello World! 2",
  "Hello World! 3",
  "Hello World! 4",
  "Hello World! 5",
  "Hello World! 6",
  "Hello World! 7",
  "Hello World! 8",
  "Hello World! 9",
  "What is the meaning of life?",
  "where is the bathroom?",
  "zoo",
  "kangaroo",
  "erlang",
  "elixir",
  "bun",
  "mochi",
  "typescript",
  "javascript",
  "Hello World! 7",
  "Hello World! 8",
  "Hello World! 9",
  "What is the meaning of life?",
  "where is the bathroom?",
  "zoo",
  "kangaroo",
  "erlang",
  "elixir",
  "bun",
  "mochi",
  "typescript",
  "javascript",
  "Hello World! 7",
  "Hello World! 8",
  "Hello World! 9",
  "What is the meaning of life?",
  "Hello World! 7",
  "Hello World! 8",
  "Hello World! 9",
  "What is the meaning of life?",
  "where is the bathroom?",
  "zoo",
  "kangaroo",
  "erlang",
  "elixir",
  "bun",
  "mochi",
  "typescript",
  "javascript",
]).flat();

const NAMES = Array.from({ length: 50 }, (a, i) => [
  "Alice" + i,
  "Bob" + i,
  "Charlie" + i,
  "David" + i,
  "Eve" + i,
  "Frank" + i,
  "Grace" + i,
  "Heidi" + i,
  "Ivan" + i,
  "Judy" + i,
  "Karl" + i,
  "Linda" + i,
  "Mike" + i,
  "Nancy" + i,
  "Oscar" + i,
  "Peggy" + i,
  "Quentin" + i,
  "Ruth" + i,
  "Steve" + i,
  "Trudy" + i,
  "Ursula" + i,
  "Victor" + i,
  "Wendy" + i,
  "Xavier" + i,
  "Yvonne" + i,
  "Zach" + i,
])
  .flat()
  .slice(0, CLIENTS_TO_WAIT_FOR);

console.log(`Connecting ${CLIENTS_TO_WAIT_FOR} WebSocket clients...`);
console.time(`All ${CLIENTS_TO_WAIT_FOR} clients connected`);

var remainingClients = CLIENTS_TO_WAIT_FOR;
var promises = [];

const clients = new Array(CLIENTS_TO_WAIT_FOR);
for (let i = 0; i < CLIENTS_TO_WAIT_FOR; i++) {
  clients[i] = new WebSocket(`${SERVER}?name=${NAMES[i]}`);
  promises.push(
    new Promise((resolve, reject) => {
      clients[i].onmessage = event => {
        if (event.data !== "ready") {
          // Warning in case clients are out of sync at the beginning
          console.error(`Incorrect signal, expected: "ready", received ${event.data}`);
        }
        resolve();
      };
    }),
  );
}

await Promise.all(promises);
console.timeEnd(`All ${clients.length} clients connected`);

var received = 0;
var more = false;
var remaining;
var t0 = 0;
var t1 = 0;

for (let i = 0; i < CLIENTS_TO_WAIT_FOR; i++) {
  clients[i].onmessage = event => {
    if (LOG_MESSAGES) console.log(event.data);
    received++;
    remaining--;

    if (remaining === 0) {
      t1 = performance.now();
      more = true;
      remaining = total;
    }
  };
}

// each message is supposed to be received
// by each client on each worker
// numberOfMessagesToBeSentByAllWorkers = CLIENTS_TO_WAIT_FOR * WORKERS * MESSAGES_TO_SEND.length;
// expectedToBeReceivedByThisWorker = numberOfMessagesToBeSentByAllWorkers * CLIENTS_TO_WAIT_FOR;
const total = CLIENTS_TO_WAIT_FOR * CLIENTS_TO_WAIT_FOR * WORKERS * MESSAGES_TO_SEND.length;
remaining = total;

function restart() {
  t0 = performance.now();
  for (let i = 0; i < CLIENTS_TO_WAIT_FOR; i++) {
    for (let j = 0; j < MESSAGES_TO_SEND.length; j++) {
      clients[i].send(MESSAGES_TO_SEND[j]);
    }
  }
}

var runs = [];
var isRestarting = false;

setInterval(() => {
  if (more && !isRestarting) {
    const secondsTaken = (t1 - t0) / 1_000;
    const rate = received / secondsTaken;
    runs.push(rate);
    received = 0;
    console.log(
      rate,
      `messages per second (${WORKERS} * ${CLIENTS_TO_WAIT_FOR} clients x ${MESSAGES_TO_SEND.length} msg, time: ${secondsTaken}s)`,
    );

    if (runs.length >= 10) {
      console.log("10 runs");
      console.log(JSON.stringify(runs, null, 2));
      const sum = runs.reduce((prev, curr) => {
        return prev + curr;
      });
      const avg = sum / runs.length;
      console.log(`Average: ${avg}`);
      if ("process" in globalThis) process.exit(0);
      runs.length = 0;
    }

    more = false;
    isRestarting = true;
    restart();
    isRestarting = false;
  }
}, DELAY);
setTimeout(() => {
  // So we can see that the clients are starting around the same millisecond
  console.log(`Starting benchmark at ${Date.now()}`);
  restart();
}, 1_000);
