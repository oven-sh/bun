// Line breaks and control characters handed to a response and to a request in many ways: through accessors, made keys, the methods of the class above, lists, pairs, maps, trailers, early hints, a path, a method, a host.
// Each way says what the call did and what a raw socket on the other side saw.
import http, { createServer, ServerResponse, OutgoingMessage } from "node:http";
import { connect } from "node:net";
const bad = "ok\r\nInjected: yes",
  said = [];
const ways = {
  "accessor, writeHead(200)": res => {
    Object.defineProperty(res, "statusMessage", { configurable: true, get: () => bad, set() {} });
    res.writeHead(200);
  },
  "accessor, writeHead(200, text)": res => {
    Object.defineProperty(res, "statusMessage", { configurable: true, get: () => bad, set() {} });
    res.writeHead(200, "fine");
  },
  "accessor that turns": res => {
    let n = 0;
    Object.defineProperty(res, "statusMessage", { configurable: true, get: () => (n++ ? bad : "ok"), set() {} });
    res.writeHead(200);
  },
  "accessor, end alone": res => {
    Object.defineProperty(res, "statusMessage", { configurable: true, get: () => bad, set() {} });
    res.end("body");
  },
  "statusMessage by a key": res => {
    const key = ["status", "Message"].join("");
    res[key] = bad;
    res.writeHead(200);
  },
  "setHeader of the prototype first": res => {
    OutgoingMessage.prototype.setHeader.call(res, "x-p", bad);
  },
  "setHeader of the prototype by a key": res => {
    OutgoingMessage.prototype[["set", "Header"].join("")].call(res, "x-p", bad);
  },
  "name of the prototype first": res => {
    OutgoingMessage.prototype.setHeader.call(res, "x-p\r\nInjected: yes", "1");
  },
  "appendHeader of the prototype first": res => {
    OutgoingMessage.prototype.appendHeader.call(res, "x-q", bad);
  },
  "value of an array": res => {
    res.setHeader("x-r", ["a", bad]);
  },
  "value that is an object": res => {
    res.setHeader("x-s", { toString: () => bad });
  },
  "writeHead with a flat list": res => {
    res.writeHead(200, ["x-v", bad]);
  },
  "writeHead with pairs": res => {
    res.writeHead(200, [["x-w", bad]]);
  },
  "writeHead with a getter that turns": res => {
    let n = 0;
    res.writeHead(200, {
      get "x-x"() {
        return n++ ? bad : "ok";
      },
    });
  },
  "writeHead text and pairs": res => {
    res.writeHead(200, "fine", [["x-z", bad]]);
  },
  "setHeaders of a Map": res => {
    res.setHeaders(new Map([["x-aa", bad]]));
  },
  "trailer of a list": res => {
    res.setHeader("trailer", "x-ab");
    res.write("a");
    res.addTrailers([["x-ab", bad]]);
  },
  "early hints": res => {
    res.writeEarlyHints({ link: "</a>; rel=preload\r\nInjected: yes" });
  },
  "early hints of another name": res => {
    res.writeEarlyHints({ link: "</a>; rel=preload; as=style", "x-ad": bad });
  },
  "_header laid by hand": res => {
    res._storeHeader?.("HTTP/1.1 200 ok\r\n", { "x-ae": bad });
  },
  "a subclass's setHeader": res => {
    class Mine extends ServerResponse {
      setHeader(n, v) {
        return super.setHeader(n, v);
      }
    }
    Mine.prototype.setHeader.call(res, "x-af", bad);
  },
  "line feed alone": res => {
    res.setHeader("x-ag", "ok\nInjected: yes");
  },
  "carriage return alone": res => {
    res.setHeader("x-ah", "ok\rInjected: yes");
  },
  "nul": res => {
    res.setHeader("x-ai", "ok\u0000x");
  },
  "a letter whose low byte is LF": res => {
    res.setHeader("x-aj", "okĊInjected: yes");
  },
  "statusMessage whose low byte is LF": res => {
    res.statusMessage = "okĊInjected: yes";
    res.writeHead(200);
  },
  "a number for a name": res => {
    res.setHeader(7, bad);
  },
};
const names = Object.keys(ways);
const server = createServer((req, res) => {
  const how = names[Number(req.url.slice(1))];
  let word = "returned";
  try {
    ways[how](res, req);
  } catch (e) {
    word = e.code ?? e.name;
  }
  said.push(how + ": " + word);
  try {
    if (!res.writableEnded) res.end("body");
  } catch (e) {
    said.push("  end: " + (e.code ?? e.name));
    res.destroy();
  }
});
server.on("clientError", (e, s) => s.destroy());
await new Promise(r => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
for (let i = 0; i < names.length; i++) {
  const raw = await new Promise(resolve => {
    let all = "";
    const s = connect(port, "127.0.0.1", () =>
      s.write("GET /" + i + " HTTP/1.1\r\nHost: x\r\nTE: trailers\r\nConnection: close\r\n\r\n"),
    );
    s.setTimeout(3000, () => s.destroy());
    s.on("data", d => (all += d.toString("latin1")));
    s.on("close", () => resolve(all));
    s.on("error", () => resolve(all));
  });
  said.push(
    "  wire: " +
      (/(\r|\n|\r\n)Injected: yes/.test(raw) ? "INJECTED" : /\u0000/.test(raw) ? "NUL" : "clean") +
      ", first line " +
      JSON.stringify(raw.split("\r\n")[0].slice(0, 30)),
  );
}
server.close();
server.closeAllConnections?.();
// the client's side: what a request puts on the wire
const lines = [],
  sink = (await import("node:net")).createServer(s => {
    let all = "";
    s.on("data", d => {
      all += d.toString("latin1");
      if (all.includes("\r\n\r\n")) {
        lines.push(all);
        s.end("HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
      }
    });
    s.on("error", () => {});
  });
await new Promise(r => sink.listen(0, "127.0.0.1", r));
const to = sink.address().port,
  ask = options =>
    new Promise(done => {
      let q;
      try {
        q = http.request({ host: "127.0.0.1", port: to, agent: false, ...options });
      } catch (e) {
        return done(e.code ?? e.name);
      }
      q.on("response", r => {
        r.resume();
        r.on("end", () => done("sent"));
      });
      q.on("error", e => done("error " + e.code));
      q.setTimeout?.(3000, () => q.destroy());
      q.end();
    });
for (const [name, options] of Object.entries({
  "path": { path: "/a\r\nInjected: yes" },
  "path with a space": { path: "/a b" },
  "path of a low byte LF": { path: "/aĊInjected:" },
  "method": { method: "GET\r\nInjected: yes" },
  "header": { headers: { "x-a": bad } },
  "header list": { headers: ["x-a", bad] },
  "host": { headers: { host: bad } },
  "auth": { auth: "a:b\r\nInjected: yes" },
})) {
  lines.length = 0;
  const word = await ask(options);
  said.push(
    "client " +
      name +
      ": " +
      word +
      ", wire " +
      (lines.some(l => /(\r|\n)Injected: yes/.test(l)) ? "INJECTED" : lines.length ? "clean" : "nothing"),
  );
}
sink.close();
console.log(said.join("\n"));
process.exit(0);
