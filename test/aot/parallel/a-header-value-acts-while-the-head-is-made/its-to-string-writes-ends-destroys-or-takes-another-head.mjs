// The value of a header is an object of the program's, and its toString() runs while end(), write() or flushHeaders() makes the head. There it writes, ends, flushes, destroys the response or its connection, takes another head or changes the headers. No accessor lies on the response: it is as its class made it. What the call does, what the client gets and which events come are as without compilation. The same deeds in front of the call are the control.
import http from "node:http";
let row = [],
  line = "",
  armed = false;
const deeds = {
  "writes": (req, res) => res.write("x"),
  "ends": (req, res) => res.end("x"),
  "flushes": (req, res) => res.flushHeaders(),
  "destroys": (req, res) => res.destroy(),
  "destroys the connection": (req, res) => req.socket.destroy(),
  "takes another head": (req, res) => {
    res.writeHead(201);
    res.statusCode = 500;
  },
  "stores another status": (req, res) => {
    res.statusCode = 202;
    res.statusMessage = "Made Up";
  },
  "sets a header": (req, res) => res.setHeader("x-late", "1"),
  "removes a header": (req, res) => res.removeHeader("x-first"),
};
const calls = {
  "end": res => (res.end("k"), "returns"),
  "first write": res => `gives ${res.write("k")}`,
  "flushHeaders": res => (res.flushHeaders(), "returns"),
};
process.on("uncaughtException", error => {
  line += ` . uncaught ${error.code}`;
});
const answer = (req, res) => {
  const [where, when, listens, call, deed, framing] = row;
  if (listens === "heard") {
    for (const name of ["error", "prefinish", "finish", "close"]) {
      res.on(name, error => {
        line += ` . ${name}${error ? " " + error.code : ""}`;
      });
    }
  }
  res.setHeader("x-first", "0");
  if (framing === "a length") res.setHeader("Content-Length", "1");
  res.setHeader("x-made-up", {
    toString() {
      if (where === "amid" && armed) {
        armed = false;
        deeds[deed](req, res);
      }
      return "1";
    },
  });
  try {
    if (where === "in front") deeds[deed](req, res);
    armed = true;
    line = calls[call](res) + line;
  } catch (error) {
    line = `throws ${error.name} ${error.code}` + line;
  }
  armed = false;
  try {
    if (!res.writableEnded && !res.destroyed)
      res.end(call === "flushHeaders" && framing === "a length" ? "k" : undefined);
  } catch (error) {
    line += ` . then ${error.code}`;
    res.destroy();
  }
};
// CLASSES names whose classes the server makes its requests and responses of. Files beside this one set it.
const classes =
  {
    "a request class": { IncomingMessage: class extends http.IncomingMessage {} },
    "a response class": { ServerResponse: class extends http.ServerResponse {} },
    "both classes": {
      IncomingMessage: class extends http.IncomingMessage {},
      ServerResponse: class extends http.ServerResponse {},
    },
    "classes with constructors": {
      IncomingMessage: class extends http.IncomingMessage {
        constructor(...values) {
          super(...values);
          this.madeUp = 1;
        }
      },
      ServerResponse: class extends http.ServerResponse {
        constructor(...values) {
          super(...values);
          this.madeUp = 1;
        }
      },
    },
  }[process.env.CLASSES] ?? {};
const server = http.createServer(classes, (req, res) => {
  if (row[1] === "later") setImmediate(answer, req, res);
  else answer(req, res);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = "http://127.0.0.1:" + server.address().port;
const guard = setTimeout(() => {
  console.log("did not end by itself");
  process.exit(1);
}, 80000);
let cases = 0;
for (const where of ["amid", "in front"]) {
  for (const when of ["at once", "later"]) {
    for (const listens of ["unheard", "heard"]) {
      for (const call of Object.keys(calls)) {
        for (const deed of Object.keys(deeds)) {
          for (const framing of ["a length", "chunks"]) {
            row = [where, when, listens, call, deed, framing];
            line = "";
            let seen = "no answer";
            try {
              const got = await fetch(url, { signal: AbortSignal.timeout(3000) });
              const heads = ["x-first", "x-made-up", "x-late"].map(name => got.headers.get(name)).join(" ");
              seen = `${got.status} ${got.statusText} ${heads} ${JSON.stringify(await got.text())}`;
            } catch {}
            await new Promise(resolve => setImmediate(resolve));
            await new Promise(resolve => setImmediate(resolve));
            console.log(`${row.join(" . ")}: ${line} | ${seen}`);
            cases++;
          }
        }
      }
    }
  }
}
clearTimeout(guard);
server.closeAllConnections();
await new Promise(resolve => server.close(resolve));
console.log(`${cases} cases`);
