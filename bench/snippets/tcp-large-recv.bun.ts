// Receives a fixed amount of data (1 GiB by default) over one loopback TCP connection in
// which the receiver never catches up: its data handler refills the sender until the kernel
// refuses, so every read fills the 512 KiB receive buffer once the kernel's buffers have
// grown. Prints how the reads spread over event loop turns and what the transfer cost.
//
//   bun tcp-large-recv.bun.ts [MiB]
import { connect, listen, type Socket } from "bun";

const total = Number(process.argv[2] ?? 1024) * 1024 * 1024;
const chunk = Buffer.alloc(1024 * 1024, "a");
// The loop reads a socket again, in the same turn, after a read of at least this size.
const fullRead = 512 * 1024 - 24 * 1024;

let sender: Socket;
let sent = 0;
let received = 0;
let reads = 0;
let fullReads = 0;
let turn = 0;
let lastTurnWithData = -1;
let turnsWithData = 0;
let readsThisTurn = 0;
let mostReadsInOneTurn = 0;
const closed = Promise.withResolvers<void>();

function fill() {
  while (sent < total) {
    const wanted = Math.min(chunk.length, total - sent);
    const written = sender.write(wanted === chunk.length ? chunk : chunk.subarray(0, wanted));
    if (written > 0) sent += written;
    if (written < wanted) return;
  }
  sender.end();
}

// One immediate runs per loop turn, so this counts turns.
setImmediate(function nextTurn() {
  turn++;
  if (received < total) setImmediate(nextTurn);
});

using listener = listen({
  hostname: "127.0.0.1",
  port: 0,
  socket: {
    data(_socket, data) {
      if (turn !== lastTurnWithData) {
        lastTurnWithData = turn;
        turnsWithData++;
        readsThisTurn = 0;
      }
      reads++;
      if (++readsThisTurn > mostReadsInOneTurn) mostReadsInOneTurn = readsThisTurn;
      if (data.length >= fullRead) fullReads++;
      received += data.length;
      fill();
    },
    close() {
      closed.resolve();
    },
  },
});

const cpuBefore = process.cpuUsage();
const start = performance.now();
await connect({
  hostname: "127.0.0.1",
  port: listener.port,
  socket: {
    open(socket) {
      sender = socket;
      fill();
    },
    drain: fill,
    data() {},
  },
});
await closed.promise;

const seconds = (performance.now() - start) / 1000;
const cpu = process.cpuUsage(cpuBefore);
const gib = received / 1024 ** 3;
const perGiB = (microseconds: number) => (microseconds / 1000 / gib).toFixed(0);
console.log(
  `${(received / 1024 ** 2).toFixed(0)} MiB in ${seconds.toFixed(2)} s (${(gib / seconds).toFixed(2)} GiB/s)`,
);
console.log(`reads: ${reads} (${fullReads} full), ${(reads / gib).toFixed(0)} per GiB`);
console.log(`loop turns with data: ${turnsWithData} (${(turnsWithData / gib).toFixed(0)} per GiB)`);
console.log(`most reads in one loop turn: ${mostReadsInOneTurn}`);
console.log(
  `cpu: ${perGiB(cpu.user + cpu.system)} ms per GiB (user ${perGiB(cpu.user)}, system ${perGiB(cpu.system)})`,
);
