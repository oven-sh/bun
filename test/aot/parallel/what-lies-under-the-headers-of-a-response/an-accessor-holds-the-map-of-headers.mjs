// The map of a response's headers lies under a symbol. An accessor of the program's under that symbol hands out a map of its own: the headers are stored there, read from there and sent from there.
import http from "node:http";
import net from "node:net";

const places = {
  "on the response": res => res,
  "on ServerResponse.prototype": () => http.ServerResponse.prototype,
  "on OutgoingMessage.prototype": () => http.OutgoingMessage.prototype,
};

function run(place, when, hasSetter) {
  return new Promise(resolve => {
    const log = [];
    let key;
    let holder;
    const maps = new WeakMap();
    const lay = res => {
      holder = place(res);
      Object.defineProperty(holder, key, {
        configurable: true,
        get() {
          let map = maps.get(this);
          if (map === undefined) maps.set(this, (map = { __proto__: null, "x-laid": ["X-Laid", "by the program"] }));
          return map;
        },
        ...(hasSetter && {
          set(value) {
            maps.set(this, value);
          },
        }),
      });
    };
    let count = 0;
    const server = http.createServer((req, res) => {
      key ??= Object.getOwnPropertySymbols(res).find(it => it.description === "kOutHeaders");
      if (++count === 1) {
        if (when === "ahead of the birth") lay(res);
        return res.end("first");
      }
      try {
        if (when === "behind one header") res.setHeader("X-Early", "0");
        if (when !== "ahead of the birth") lay(res);
        res.setHeader("X-One", "1");
        res.setHeader("X-Two", 2);
        const map = res[key];
        log.push("map " + (map ? Object.keys(map).sort().join() : String(map)));
        log.push("get " + res.getHeader("x-one") + " " + res.getHeader("x-laid") + " " + res.getHeader("x-early"));
        log.push("has " + res.hasHeader("x-two") + " " + res.hasHeader("x-laid"));
        log.push("names " + res.getHeaderNames().sort().join());
        res.removeHeader("x-two");
        log.push("removed " + res.hasHeader("x-two"));
      } catch (error) {
        log.push("thrown " + error.constructor.name);
      }
      res.end("second");
    });
    server.listen(0, "127.0.0.1", () => {
      const client = net.connect(server.address().port, "127.0.0.1");
      const limit = setTimeout(() => client.destroy(), 500);
      let text = "";
      let sent = 1;
      client.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
      client.on("data", chunk => {
        text += chunk;
        if (sent === 1 && text.endsWith("first")) {
          sent = 2;
          text = "";
          client.write("GET / HTTP/1.1\r\nHost: a\r\nConnection: close\r\n\r\n");
        }
      });
      client.on("error", () => {});
      client.on("close", () => {
        clearTimeout(limit);
        server.close();
        if (holder !== undefined) delete holder[key];
        const sentNames = text
          .split("\r\n\r\n")[0]
          .split("\r\n")
          .slice(1)
          .map(line => line.split(":")[0].toLowerCase())
          .filter(name => name.startsWith("x-"))
          .sort();
        resolve(log.join(" | ") + " | sent " + sentNames.join());
      });
    });
  });
}

process.on("uncaughtException", error => console.log("uncaught", error.constructor.name));
for (const [label, place] of Object.entries(places)) {
  for (const when of ["ahead of the birth", "in the handler", "behind one header"]) {
    if (label === "on the response" && when === "ahead of the birth") continue;
    for (const hasSetter of [true, false]) {
      console.log(label, when, hasSetter ? "with a setter" : "without a setter", ":", await run(place, when, hasSetter));
    }
  }
}
process.exit(0);
