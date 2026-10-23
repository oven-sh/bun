// node:http leaves its keep-alive timer armed across requests; when it fires on a connection that has answered, it grants what is left of the idle time since the last answer.
// A connection in use outlives any number of timeouts, where the answer is written whole and where it is piped. An idle one is closed, and not before its time.
// A process that the machine holds for as long as the timeout closes connections in use under every engine, because timers fire before reads: such a try does not count.
import http from "node:http";
import net from "node:net";
import { Readable } from "node:stream";

const timeout = 600;
const server = http.createServer((request, response) => {
  if (request.url === "/piped") Readable.from(["a,", "b,", "c"]).pipe(response);
  else response.end("whole");
});
server.keepAliveTimeout = timeout;
server.keepAliveTimeoutBuffer = 0;

function useThenLeaveIdle(port) {
  return new Promise(resolve => {
    const began = performance.now();
    let text = "";
    let answered = 0;
    let lastAnswer = began;
    let longestWait = 0;
    let isIdle = false;
    const ask = () => client.write(`GET ${answered % 2 ? "/piped" : "/whole"} HTTP/1.1\r\nHost: localhost\r\n\r\n`);
    const client = net.connect(port, "127.0.0.1", ask);
    client.on("data", chunk => {
      text += chunk;
      if (!text.endsWith(answered % 2 ? "0\r\n\r\n" : "whole")) return;
      const now = performance.now();
      longestWait = Math.max(longestWait, now - lastAnswer);
      lastAnswer = now;
      text = "";
      answered++;
      if (now - began < timeout * 2.5) ask();
      else isIdle = true;
    });
    client.on("error", () => {});
    client.on("close", () => resolve({ isIdle, idleFor: performance.now() - lastAnswer, longestWait }));
  });
}

server.listen(0, "127.0.0.1", async () => {
  let result;
  for (let tries = 0; tries < 5; tries++) {
    result = await useThenLeaveIdle(server.address().port);
    if (result.longestWait < timeout / 2) break;
  }
  console.log(result.isIdle ? "in use for over two timeouts: still open" : "closed while in use");
  console.log(result.idleFor >= timeout * 0.9 ? "idle: closed, and not before its time" : "closed before its time");
  server.close();
});
