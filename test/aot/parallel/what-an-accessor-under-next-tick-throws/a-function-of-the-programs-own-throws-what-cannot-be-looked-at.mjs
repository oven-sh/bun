// A process.nextTick of the program's own, laid by a listener for `end`, throws an object whose `stack` throws when it is read. The destruction of the request catches the object and looks at it: what that look throws is caught by nobody.
import http from "node:http";
const original = process.nextTick;
const lines = [];
process.on("uncaughtException", error => lines.push("uncaught: " + error.message));
const server = http.createServer((req, res) => {
  req.on("error", error => lines.push("the request emits error: " + error.message));
  req.on("close", () => lines.push("the request closes, errored " + (req.errored && req.errored.message)));
  req.on("end", () => {
    process.nextTick = function (callback, ...rest) {
      process.nextTick = original;
      lines.push("handed " + callback.name + " with " + rest.length + ", destroyed " + req.destroyed);
      throw {
        get stack() {
          throw new Error("out of the look at the stack");
        },
      };
    };
    setTimeout(() => res.end("ok"), 10);
  });
  req.resume();
});
server.listen(0, "127.0.0.1", async () => {
  for (const options of [{}, { method: "POST", body: "sent" }]) {
    const response = await fetch("http://127.0.0.1:" + server.address().port + "/", options);
    lines.push(response.status + " " + (await response.text()));
  }
  console.log(lines.join("\n"));
  server.close();
});
