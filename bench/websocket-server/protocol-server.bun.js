// Echo and pub/sub server shared by the HTTP/1.1 and RFC 8441 benchmark cases.
const workload = process.env.WORKLOAD ?? "echo";
if (workload !== "echo" && workload !== "pubsub-self") {
  throw new Error(`invalid WORKLOAD: ${workload}`);
}

let openWebSockets = 0;
let maxRss = process.memoryUsage.rss();
const rssSampler = setInterval(() => {
  maxRss = Math.max(maxRss, process.memoryUsage.rss());
}, 250);
rssSampler.unref();

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.PORT ?? 0),
  http1: true,
  http2: true,
  websocket: {
    perMessageDeflate: false,
    sendPings: false,
    idleTimeout: 120,
    maxPayloadLength: 1024 * 1024,
    backpressureLimit: 16 * 1024 * 1024,
    publishToSelf: workload === "pubsub-self",
    open(ws) {
      openWebSockets++;
      if (workload === "pubsub-self") ws.subscribe(ws.data.topic);
    },
    message(ws, message) {
      if (workload === "pubsub-self") ws.publish(ws.data.topic, message);
      else ws.send(message);
    },
    close() {
      openWebSockets--;
    },
  },
  fetch(request, server) {
    if (request.url.endsWith("/__websocket_benchmark_metrics__")) {
      const rss = process.memoryUsage.rss();
      maxRss = Math.max(maxRss, rss);
      return Response.json({
        rss,
        maxRss,
        openWebSockets,
      });
    }
    if (workload === "pubsub-self") {
      const topic = new URL(request.url).searchParams.get("topic");
      if (!topic) return new Response("Missing benchmark topic", { status: 400 });
      if (server.upgrade(request, { data: { topic } })) return;
    } else if (server.upgrade(request)) {
      return;
    }
    return new Response("WebSocket required", { status: 426 });
  },
});

console.log(JSON.stringify({ event: "ready", port: server.port }));

function stop() {
  clearInterval(rssSampler);
  server.stop(true);
  process.exit(0);
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
