// What one turn of the event loop costs, by the kind of turn.
//
//   bun bench/snippets/event-loop-turn.mjs [kind ...]
//   node bench/snippets/event-loop-turn.mjs [kind ...]
//
// For each kind it prints one line of JSON: the wall time and the CPU time of the process for one turn
// and, on Linux, how often the threads of the process went to sleep (voluntary context switches, read
// from /proc). `scavenger` is the thread of the allocator that returns memory to the OS ("mi-scavenger"
// in bun): each time it goes to sleep it was woken before, so its count is a lower bound of its wakes.
//
// Kinds:
//   immediate         a turn that does not wait: `setImmediate`
//   immediate-50us    the same with 50 us of JavaScript in each turn
//   immediate-500us   the same with 500 us of JavaScript in each turn
//   timeout-0         `setTimeout(fn, 0)`
//   timer-1ms         a turn that waits for 1 ms: `setTimeout(fn, 1)`
//   fs-stat           a turn that waits for the thread pool: `fs.promises.stat`
//   fetch             a request to a server in this process, one at a time
//   serve             requests from another process over 16 connections that are kept alive
//   serve-busy        requests from 4 other processes, so that a poll of the server finds requests waiting
import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { connect } from "node:net";
import { fileURLToPath } from "node:url";

const self = fileURLToPath(import.meta.url);

// the load of the `serve` kinds: it runs in a process of its own so that its turns are not counted
if (process.argv[2] === "--client") {
  const [port, connections, requests] = process.argv.slice(3).map(Number);
  const request = Buffer.from("GET / HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
  const sockets = [];
  let sent = 0;
  let done = 0;
  let open = connections;
  for (let i = 0; i < connections; i++) {
    let tail = "";
    const socket = connect(port, "127.0.0.1", () => {
      sent++;
      socket.write(request);
    });
    socket.setNoDelay(true);
    sockets.push(socket);
    socket.on("data", chunk => {
      // a response ends with its body, which is "ok"
      const text = tail + chunk.toString("latin1");
      let count = 0;
      for (let at = text.indexOf("\r\n\r\nok"); at !== -1; at = text.indexOf("\r\n\r\nok", at + 6)) count++;
      tail = text.slice(-5);
      for (let k = 0; k < count; k++) {
        done++;
        if (sent < requests) {
          sent++;
          socket.write(request);
        }
      }
      if (done >= requests) for (const each of sockets) each.end();
    });
    socket.on("close", () => {
      if (--open === 0) process.exit(0);
    });
  }
} else {
  const kinds = {
    "immediate": { turns: 20000, turn: () => new Promise(resolve => setImmediate(resolve)) },
    "immediate-50us": { turns: 20000, turn: () => (spin(50), new Promise(resolve => setImmediate(resolve))) },
    "immediate-500us": { turns: 4000, turn: () => (spin(500), new Promise(resolve => setImmediate(resolve))) },
    "timeout-0": { turns: 2000, turn: () => new Promise(resolve => setTimeout(resolve, 0)) },
    "timer-1ms": { turns: 2000, turn: () => new Promise(resolve => setTimeout(resolve, 1)) },
    "fs-stat": { turns: 2000, turn: () => stat(self) },
    "fetch": {
      turns: 2000,
      server: true,
      turn: port => fetch(`http://127.0.0.1:${port}/`).then(response => response.text()),
    },
    "serve": { turns: 20000, server: true, clients: 1 },
    "serve-busy": { turns: 80000, server: true, clients: 4 },
  };

  const wanted = process.argv.slice(2);
  for (const name of wanted) {
    if (!(name in kinds)) throw new Error(`unknown kind "${name}", the kinds are: ${Object.keys(kinds).join(", ")}`);
  }

  for (const [name, kind] of Object.entries(kinds)) {
    if (wanted.length > 0 && !wanted.includes(name)) continue;
    const server = kind.server ? await listen() : undefined;
    // a few turns first: the threads that the kind needs exist then, and the code is warm
    if (kind.turn) for (let i = 0; i < 50; i++) await kind.turn(server?.port);
    await new Promise(resolve => setTimeout(resolve, 150));

    const sleepsBefore = sleeps();
    const cpuBefore = process.cpuUsage();
    const start = performance.now();
    if (kind.clients) {
      const clients = [];
      for (let i = 0; i < kind.clients; i++) {
        clients.push(
          new Promise((resolve, reject) => {
            const args = [self, "--client", String(server.port), "16", String(kind.turns / kind.clients)];
            const child = spawn(process.execPath, args, { stdio: ["ignore", "inherit", "inherit"] });
            child.on("error", reject);
            child.on("exit", code => (code === 0 ? resolve() : reject(new Error(`the client exited with ${code}`))));
          }),
        );
      }
      await Promise.all(clients);
    } else {
      for (let i = 0; i < kind.turns; i++) await kind.turn(server?.port);
    }
    const ms = performance.now() - start;
    const cpu = process.cpuUsage(cpuBefore);
    const sleepsAfter = sleeps();
    await server?.close();

    const result = {
      kind: name,
      turns: kind.turns,
      ms: Math.round(ms),
      wall_us_per_turn: round((ms * 1000) / kind.turns),
      cpu_us_per_turn: round((cpu.user + cpu.system) / kind.turns),
      user_us_per_turn: round(cpu.user / kind.turns),
      system_us_per_turn: round(cpu.system / kind.turns),
    };
    if (sleepsAfter) {
      result.sleeps = {
        loop: sleepsAfter.loop - sleepsBefore.loop,
        scavenger: sleepsAfter.scavenger - sleepsBefore.scavenger,
        others: sleepsAfter.others - sleepsBefore.others,
      };
      result.scavenger_sleeps_per_turn = round(result.sleeps.scavenger / kind.turns, 4);
    }
    console.log(JSON.stringify(result));
  }
  process.exit(0);
}

function round(value, digits = 2) {
  return Number(value.toFixed(digits));
}

function spin(us) {
  const end = performance.now() + us / 1000;
  let x = 0;
  while (performance.now() < end) for (let i = 0; i < 100; i++) x += i;
  return x;
}

// how often the threads of this process went to sleep, by thread: this one, the scavenger, and the rest
function sleeps() {
  if (process.platform !== "linux") return undefined;
  const counts = { loop: 0, scavenger: 0, others: 0 };
  const loop = readFileSync("/proc/thread-self/stat", "utf8").split(" ")[0];
  for (const tid of readdirSync("/proc/self/task")) {
    let status;
    try {
      status = readFileSync(`/proc/self/task/${tid}/status`, "utf8");
    } catch {
      continue; // the thread ended
    }
    const switches = Number(/^voluntary_ctxt_switches:\s+(\d+)/m.exec(status)[1]);
    const name = /^Name:\s+(.*)$/m.exec(status)[1];
    if (tid === loop) counts.loop += switches;
    else if (name === "mi-scavenger") counts.scavenger += switches;
    else counts.others += switches;
  }
  return counts;
}

async function listen() {
  if (typeof Bun !== "undefined") {
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", routes: { "/": new Response("ok") } });
    return { port: server.port, close: () => server.stop(true) };
  }
  const server = createServer((request, response) => response.end("ok"));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return {
    port: server.address().port,
    close: () => new Promise(resolve => (server.closeAllConnections(), server.close(resolve))),
  };
}
