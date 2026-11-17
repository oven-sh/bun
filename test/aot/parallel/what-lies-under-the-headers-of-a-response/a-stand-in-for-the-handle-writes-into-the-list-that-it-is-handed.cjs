// What lies under the symbol of a response's handle may be an object of the program's. Its functions are handed the list of headers: what they put into it goes out with no other response, and putting it there throws nothing.
const http = require("node:http");
const net = require("node:net");

let turn = 0;
let thrown = "nothing";
const server = http.createServer((req, res) => {
  if (turn++ === 0) {
    const symbol = Object.getOwnPropertySymbols(res).find(it => it.description === "handle");
    const real = res[symbol];
    res[symbol] = {
      get flags() {
        return real.flags;
      },
      get finished() {
        return real.finished;
      },
      get bufferedAmount() {
        return real.bufferedAmount;
      },
      writeWholeResponse() {
        return undefined;
      },
      writeHeadAndEnd(status, message, headers, ...rest) {
        try {
          headers.push("X-Made-Up", "1");
        } catch (error) {
          thrown = error.constructor.name;
        }
        return real.writeHeadAndEnd(status, message, headers.slice(0, 0), ...rest);
      },
    };
  }
  res.end("ok");
});

function ask(port) {
  return new Promise(resolve => {
    let text = "";
    const client = net.connect(port, "127.0.0.1", () => client.write("GET / HTTP/1.1\r\nHost: a\r\nConnection: close\r\n\r\n"));
    client.on("data", chunk => (text += chunk));
    client.on("error", () => {});
    client.on("close", () => resolve(`${text.slice(0, 12)} made-up ${/x-made-up/i.test(text)}`));
  });
}

process.on("uncaughtException", error => console.log("uncaught", error.constructor.name));
server.listen(0, "127.0.0.1", async () => {
  const { port } = server.address();
  for (const label of ["through the stand-in", "the next", "the one behind it"]) console.log(label, ":", await ask(port));
  console.log("thrown", thrown);
  process.exit(0);
});
