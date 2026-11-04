// A listener writes to its response, and the process or the worker that serves ends before another tick runs: by process.exit(), process.reallyExit(), an exception that nobody catches, an exit code with nothing left to do, a signal. Each client prints what it read, and no listener of 'exit' is added.
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const tls = require("node:tls");
const { spawn } = require("node:child_process");
const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");
const certificate = require("./certificate.json");

const five = { "Content-Length": 5 };
const hello = res => {
  res.writeHead(200, five);
  res.write("hello");
};

// What the listener does with the last request. `waiting` holds the responses of the connections that asked before.
const forms = {
  "exit"(res) {
    hello(res);
    process.exit(0);
  },
  "exit with a code"(res) {
    hello(res);
    process.exit(3);
  },
  "a header, a status and exit"(res) {
    res.statusCode = 201;
    res.setHeader("Content-Length", 5);
    res.write("hello");
    process.exit(0);
  },
  "part of the length and exit"(res) {
    res.writeHead(200, five);
    res.write("he");
    process.exit(0);
  },
  "bytes and exit"(res) {
    res.writeHead(200, five);
    res.write(Buffer.from("hello"));
    process.exit(0);
  },
  "no length and exit"(res) {
    res.write("hello");
    process.exit(0);
  },
  "end() and exit"(res) {
    hello(res);
    res.end();
    process.exit(0);
  },
  "reallyExit"(res) {
    hello(res);
    process.reallyExit(0);
  },
  "exit in a tick queued in front"(res) {
    process.nextTick(() => process.exit(0));
    hello(res);
  },
  "exit in a tick queued behind"(res) {
    hello(res);
    process.nextTick(() => process.exit(0));
  },
  "exit in a microtask"(res) {
    hello(res);
    queueMicrotask(() => process.exit(0));
  },
  "exit in a listener of 'finish' of another response"(res, [other]) {
    other.on("finish", () => process.exit(0));
    other.end("bye");
    hello(res);
  },
  "three responses and exit"(res, waiting) {
    [...waiting, res].forEach(hello);
    process.exit(0);
  },
  "three responses and reallyExit in a tick queued in front"(res, waiting) {
    process.nextTick(() => process.reallyExit(0));
    [...waiting, res].forEach(hello);
  },
  "a listener of 'exit' writes"(res) {
    process.on("exit", () => hello(res));
    process.exit(0);
  },
  "a listener of 'exit' writes the rest"(res) {
    res.writeHead(200, five);
    res.write("he");
    process.on("exit", () => res.write("llo"));
    process.exit(0);
  },
  "a listener of 'exit' ends the response"(res) {
    hello(res);
    process.on("exit", () => res.end());
    process.exit(0);
  },
  "a listener of 'exit' exits"(res) {
    hello(res);
    process.on("exit", () => process.exit(6));
    process.exit(0);
  },
  "a listener of 'exit' counts the listeners"(res, waiting, say) {
    const before = process.listenerCount("exit");
    hello(res);
    process.on("exit", () => say(`${process.listenerCount("exit") - before} more`));
    process.exit(0);
  },
  "exit behind a process.nextTick of the program that passes the ticks on"(res) {
    const original = process.nextTick;
    process.nextTick = function (...all) {
      return original.apply(this, all);
    };
    hello(res);
    process.exit(0);
  },
  "exit behind a process.nextTick of the program that keeps the ticks"(res) {
    process.nextTick = () => {};
    hello(res);
    process.exit(0);
  },
  "exit in a getter that native code calls"(res) {
    hello(res);
    JSON.stringify({
      get member() {
        return process.exit(0);
      },
    });
  },
  "exit, and a listener of 'exit' throws"(res) {
    hello(res);
    process.on("exit", () => {
      throw new Error("boom");
    });
    process.exit(0);
  },
  "an exit code and a server that holds nothing open"(res, waiting, say, server) {
    hello(res);
    process.exitCode = 4;
    server.close();
    server.closeAllConnections();
  },
  "an exception that nobody catches"(res) {
    hello(res);
    throw new Error("boom");
  },
  "an exception that nobody catches in a tick queued in front"(res) {
    process.nextTick(() => {
      throw new Error("boom");
    });
    hello(res);
  },
  "a listener of 'uncaughtException' exits"(res) {
    process.on("uncaughtException", () => process.exit(5));
    process.nextTick(() => {
      throw new Error("boom");
    });
    hello(res);
  },
  "a signal that nothing can catch"(res) {
    hello(res);
    process.kill(process.pid, "SIGKILL");
  },
};

// form, connections, requests that the last connection was answered before, over TLS, in a worker
const plays = [
  ...Object.keys(forms).map(form => [form, /three|another/.test(form) ? (/three/.test(form) ? 3 : 2) : 1, 1]),
  ["exit", 1, 0],
  ["reallyExit", 1, 0],
  ["exit in a tick queued in front", 1, 0],
  ["exit", 1, 1, true],
  ["exit", 1, 0, true],
  ["reallyExit", 1, 1, true],
  ["three responses and exit", 3, 1, true],
  ["exit", 1, 1, false, true],
  ["exit", 1, 0, false, true],
  ["exit with a code", 1, 1, false, true],
  ["reallyExit", 1, 1, false, true],
  ["exit in a tick queued in front", 1, 1, false, true],
  ["three responses and exit", 3, 1, false, true],
  ["a listener of 'exit' writes", 1, 1, false, true],
  ["an exception that nobody catches", 1, 1, false, true],
  ["exit", 1, 1, true, true],
];

function serve(form, isSecure, say) {
  const waiting = [];
  const listener = (req, res) => {
    if (req.url === "/warm-up") return void res.end("ok");
    if (req.url === "/wait") return void (waiting.push(res), say("waits"));
    forms[form](res, waiting, say, server);
  };
  const server = isSecure ? https.createServer(certificate, listener) : http.createServer(listener);
  server.listen(0, "127.0.0.1", () => say(String(server.address().port)));
}

const get = path => `GET ${path} HTTP/1.1\r\nHost: a\r\n\r\n`;

// Connects, asks for `paths` one after the other, each behind the answer "ok" to the one before, and resolves with what came behind the last "ok".
function ask(port, isSecure, paths) {
  const { promise, resolve } = Promise.withResolvers();
  const client = isSecure
    ? tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false })
    : net.connect(port, "127.0.0.1");
  let wire = "";
  let next = 1;
  client.on("data", bytes => {
    wire += bytes.toString("latin1");
    if (next === paths.length || !wire.endsWith("ok")) return;
    wire = "";
    client.write(get(paths[next++]));
  });
  client.on("error", error => (wire += ` [${error.code}]`));
  client.on("close", () => resolve(JSON.stringify(wire.replace(/date: [^\r]*\r\n/gi, ""))));
  client.write(get(paths[0]));
  return promise;
}

async function play(form, connections, warmUps, isSecure = false, inWorker = false) {
  const said = [];
  let hear = null;
  const line = () => (said.length > 0 ? said.shift() : new Promise(resolve => (hear = resolve)));
  const take = text => {
    if (hear === null) return void said.push(text);
    const heard = hear;
    hear = null;
    heard(text);
  };
  const ended = Promise.withResolvers();
  if (inWorker) {
    const worker = new Worker(__filename, { workerData: { form, isSecure }, stderr: true });
    worker.on("message", take);
    worker.on("error", () => {});
    worker.on("exit", code => ended.resolve(`exit code ${code}`));
  } else {
    const self = /[$~]bun/i.test(process.argv[1]) ? [process.execPath] : [process.execPath, process.argv[1]];
    const child = spawn(self[0], self.slice(1), {
      env: { ...process.env, SERVES: form, SECURE: isSecure ? "1" : "" },
      stdio: ["ignore", "pipe", "ignore"],
    });
    let text = "";
    child.stdout.on("data", bytes => {
      const lines = (text += bytes).split("\n");
      text = lines.pop();
      lines.forEach(take);
    });
    child.on("close", (code, signal) => ended.resolve(signal ?? `exit code ${code}`));
  }
  const port = Number(await line());
  const answers = [];
  for (let i = 1; i < connections; i++) {
    answers.push(ask(port, isSecure, ["/wait"]));
    await line();
  }
  answers.push(ask(port, isSecure, [...Array(warmUps).fill("/warm-up"), "/"]));
  const read = await Promise.all(answers);
  return [...read, await ended.promise, ...said].join(" | ");
}

if (!isMainThread) {
  serve(workerData.form, workerData.isSecure, text => parentPort.postMessage(text));
} else if (process.env.SERVES) {
  serve(process.env.SERVES, process.env.SECURE === "1", text => console.log(text));
} else {
  const told = async ([form, connections, warmUps, isSecure, inWorker]) => {
    const where = `${inWorker ? "a worker" : "a process"}${isSecure ? ", TLS" : ""}, behind ${warmUps}`;
    return `${form}, ${where}: ${await play(form, connections, warmUps, isSecure, inWorker)}`;
  };
  (async () => {
    for (let at = 0; at < plays.length; at += 6) {
      console.log((await Promise.all(plays.slice(at, at + 6).map(told))).join("\n"));
    }
  })();
}
