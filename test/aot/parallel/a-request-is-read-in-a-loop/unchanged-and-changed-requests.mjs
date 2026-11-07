// `for await (const chunk of req)` in a server of node:http: a request as it comes, and requests whose read(), destroyed or prototype are the program's; a loop that leaves early; a client that goes away.
import http from "node:http";
import net from "node:net";
import { Readable } from "node:stream";

const log = [];
const say = (...words) => log.push(words.join(" "));
const tick = () => new Promise(resolve => setImmediate(resolve));
// Once a request: how often a stream is read hangs on how the body arrives.
let told = new Set();
const note = words => {
  if (told.has(words)) return;
  told.add(words);
  say("    " + words);
};

const turns = {
  "as it comes": () => {},
  "a read of its own": req => {
    req.read = function (n) {
      const chunk = Readable.prototype.read.call(this, n);
      note("its own read");
      return chunk;
    };
  },
  "destroyed through an accessor of its own": req => {
    Object.defineProperty(req, "destroyed", { configurable: true, get() { note("destroyed is read"); return false; } });
  },
  "destroyed says yes": req => {
    Object.defineProperty(req, "destroyed", { configurable: true, value: true });
  },
  "another prototype in between": req => {
    Object.setPrototypeOf(req, Object.create(Object.getPrototypeOf(req), { read: { value(n) { note("the read in between"); return Readable.prototype.read.call(this, n); } } }));
  },
  "a property that has nothing to do with it": req => { req.mine = 1; },
  "an encoding": req => req.setEncoding("utf8"),
  "a state of its own kind": req => {
    const state = req._readableState;
    Object.setPrototypeOf(state, Object.create(Object.getPrototypeOf(state)));
  },
};
let turn = "as it comes", leavesEarly = false, destroysAmid = false;
class Heir extends http.IncomingMessage {
  read(n) {
    note("the read of the heir");
    return super.read(n);
  }
}
async function handle(req, res) {
  told = new Set();
  turns[turn]?.(req);
  const sizes = [];
  try {
    for await (const chunk of req) {
      sizes.push(typeof chunk + chunk.length);
      if (leavesEarly) break;
      if (destroysAmid) say("    a chunk of", chunk.length);
      if (destroysAmid && sizes.length === 1) {
        req.unshift(Buffer.from("put back"));
        if (destroysAmid === "by its state") req._readableState.destroyed = true;
        else req.destroy();
      }
    }
    say("  read", sizes.length > 0, sizes.reduce((sum, size) => sum + Number(size.replace(/\D/g, "")), 0), "| destroyed", Reflect.get(Readable.prototype, "destroyed", req), "ended", req.readableEnded, "listeners", req.eventNames().map(String).join() || "none");
  } catch (error) {
    say("  failed", error.code ?? error.message);
  }
  res.end("ok");
}
function send(port, body, pieces = 1) {
  return new Promise(resolve => {
    const request = http.request({ port, host: "127.0.0.1", method: "POST", agent: false }, response => {
      clearTimeout(patience);
      response.resume();
      response.on("close", resolve);
    });
    request.on("error", resolve);
    const patience = setTimeout(() => {
      say("  no answer");
      request.destroy();
    }, 1500);
    const size = Math.ceil(body.length / pieces);
    let at = 0;
    (function next() {
      if (at >= body.length) return request.end();
      request.write(body.slice(at, (at += size)));
      setTimeout(next, 5);
    })();
  });
}

for (const options of [{}, { IncomingMessage: Heir }]) {
  const server = http.createServer(options, handle);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  for (turn in turns) {
    for (leavesEarly of [false, true]) {
      say("==", options.IncomingMessage ? "an heir," : "a request,", turn, leavesEarly ? "| the loop leaves early" : "");
      await send(port, "x".repeat(1000));
      await tick();
    }
  }
  turn = "as it comes";
  leavesEarly = false;
  say("== something is put back and the request is destroyed amid the loop");
  destroysAmid = true;
  await send(port, "x".repeat(1000));
  say("== something is put back and the state alone is marked as destroyed amid the loop");
  destroysAmid = "by its state";
  await send(port, "x".repeat(1000));
  destroysAmid = false;
  for (const name of ["destroyed", "read"]) {
    say("== the prototype of all requests gets a", name, "of the program's");
    const home = http.IncomingMessage.prototype;
    if (name === "read") home.read = function (n) { note("the read of all requests"); return Readable.prototype.read.call(this, n); };
    else Object.defineProperty(home, name, { configurable: true, get() { note("destroyed of all requests is read"); return Reflect.get(Readable.prototype, name, this); }, set(value) { Reflect.set(Readable.prototype, name, value, this); } });
    await send(port, "x".repeat(1000));
    delete home[name];
    say("== and loses it again");
    await send(port, "x".repeat(1000));
  }
  say("== Readable's own read is replaced");
  const written = Readable.prototype.read;
  Readable.prototype.read = function (n) {
    note("the new read of Readable");
    return written.call(this, n);
  };
  await send(port, "x".repeat(1000));
  Readable.prototype.read = written;
  say("== and put back");
  await send(port, "x".repeat(1000));
  say("== no body");
  await send(port, "");
  say("== a body in three pieces");
  await send(port, "y".repeat(3000), 3);
  say("== a large body");
  await send(port, "z".repeat(300000));
  say("== the client goes away amid the body");
  await new Promise(resolve => {
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.write("POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 100\r\n\r\nhalf");
      setTimeout(() => socket.destroy(), 30);
    });
    socket.on("close", () => setTimeout(resolve, 50));
  });
  await new Promise(resolve => server.close(resolve));
}

console.log(log.join("\n"));
