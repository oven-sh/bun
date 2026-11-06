// A program that names node:cluster and forks itself: the worker's half of listen() is in the executable. The worker serves over node:http and over node:net, and the primary hears of both.
import cluster from "node:cluster";
import { createServer } from "node:http";
import net from "node:net";

if (cluster.isPrimary) {
  const worker = cluster.fork();
  const heard = [];
  cluster.on("listening", async (from, address) => {
    heard.push(address.port);
    if (heard.length < 2) return;
    const answer = await fetch("http://127.0.0.1:" + heard[0] + "/a");
    console.log("over http:", answer.status, await answer.text());
    const socket = net.connect(heard[1], "127.0.0.1");
    let text = "";
    socket.on("data", piece => (text += piece));
    socket.on("end", () => {
      console.log("over net:", text);
      worker.kill();
    });
  });
  cluster.on("exit", from => console.log("the worker left:", from === worker));
} else {
  console.log("in the worker:", cluster.isWorker, typeof process.send);
  createServer((request, response) => response.end("from the worker " + request.url)).listen(0, () => {
    net.createServer(socket => socket.end("from the worker too")).listen(0);
  });
}
