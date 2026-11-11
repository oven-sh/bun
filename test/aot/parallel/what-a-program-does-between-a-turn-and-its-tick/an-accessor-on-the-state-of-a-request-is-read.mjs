// An accessor of the program's on a field of a request's state is read where the body arrives, in its place among what the program hears.
import http from "node:http";
import net from "node:net";

const fields = ["highWaterMark", "length", "buffer", "awaitDrainWriters"];

function run(field, listens) {
  return new Promise(resolve => {
    const log = [];
    let send;
    const server = http.createServer((req, res) => {
      let isTold = false;
      if (listens === "data") {
        req.on("data", chunk => {
          log.push("data " + chunk.length);
          process.nextTick(() => log.push("tick"));
        });
      } else {
        req.on("readable", () => {
          const chunk = req.read();
          log.push("readable " + (chunk === null ? "null" : chunk.length));
        });
      }
      req.on("end", () => {
        log.push("end");
        res.end("ok");
      });
      setTimeout(() => {
        const state = req._readableState;
        let held = state[field];
        Object.defineProperty(state, field, {
          configurable: true,
          set(value) {
            held = value;
          },
          get() {
            if (!isTold) {
              isTold = true;
              log.push("read");
            }
            return held;
          },
        });
        send();
      }, 20);
    });
    server.listen(0, "127.0.0.1", () => {
      const client = net.connect(server.address().port, "127.0.0.1");
      const limit = setTimeout(() => client.destroy(), 500);
      client.write("POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 5\r\nConnection: close\r\n\r\n");
      send = () => client.write("hello");
      client.on("data", () => {});
      client.on("error", () => {});
      client.on("close", () => {
        clearTimeout(limit);
        server.close();
        resolve(log.join(" | "));
      });
    });
  });
}

for (const field of fields) {
  for (const listens of ["data", "readable"]) console.log(field, listens, ":", await run(field, listens));
}
process.exit(0);
