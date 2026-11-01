// A package of fake timers replaces the global timer functions. As in Node, the timers of Bun's own modules go on.
// Alone: what the build knows to be replaced goes by every program of the executable
import FakeTimers from "fake-clock";
import { once } from "node:events";
import http from "node:http";
import net from "node:net";
const realSetTimeout = setTimeout;
const clock = FakeTimers.install({
  toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate"],
});
const server = net.createServer(() => {});
server.listen(0);
await once(server, "listening");
{
  const socket = net.connect(server.address().port);
  await once(socket, "connect");
  let fired = false;
  socket.setTimeout(60_000, () => (fired = true));
  clock.tick(120_000);
  await Promise.resolve();
  console.log(
    "two minutes on the clock: the socket's timeout",
    fired ? "fired" : "did not fire",
    "| the clock counts",
    clock.countTimers(),
  );
  socket.destroy();
}
{
  const socket = net.connect(server.address().port);
  socket.setTimeout(30);
  const fires = once(socket, "timeout").then(() => "fired by itself");
  console.log(
    "a socket's timeout of 30 ms:",
    await Promise.race([fires, new Promise(resolve => realSetTimeout(resolve, 1500, "never fired"))]),
  );
  socket.destroy();
}
server.close();
{
  const web = http.createServer((request, response) => response.end("ok"));
  web.listen(0);
  await once(web, "listening");
  const answer = new Promise((resolve, reject) =>
    http
      .get({ port: web.address().port, agent: false, timeout: 1000 }, response => {
        let body = "";
        response.on("data", chunk => (body += chunk));
        response.on("end", () => resolve(body));
      })
      .on("error", reject),
  );
  console.log(
    "a request:",
    await Promise.race([answer, new Promise(resolve => realSetTimeout(resolve, 1500, "no answer"))]),
    "| the clock counts",
    clock.countTimers(),
  );
  web.close();
  web.closeAllConnections();
}
clock.uninstall();
