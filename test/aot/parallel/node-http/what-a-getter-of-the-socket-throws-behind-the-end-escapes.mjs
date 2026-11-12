// A response that has ended lets go of its socket. What an accessor of the program's on the socket throws there is the program's to hear, and nothing is stored behind it.
import { createServer } from "node:http";
const said = [];
process.on("uncaughtException", error => said.push("escaped: " + error.message));
const server = createServer((req, res) => {
  const held = req.socket._httpMessage;
  let reads = 0;
  Object.defineProperty(req.socket, "_httpMessage", {
    configurable: true,
    get() {
      if (++reads === 1) throw new Error("made up");
      return held;
    },
    set(value) {
      said.push("stored " + value);
    },
  });
  res.end("ok");
});
server.listen(0, "127.0.0.1", async () => {
  said.push(await (await fetch("http://127.0.0.1:" + server.address().port + "/")).text());
  server.closeAllConnections();
  server.close(() =>
    setTimeout(() => {
      console.log(said.join(" | "));
      process.exit(0);
    }, 20),
  );
});
