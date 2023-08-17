const { hostname, port } = Bun.serve({
  port: 0,
  development: true,
  inspector: true,
  fetch: request => {
    console.log(request);
    debugger;
    return new Response();
  },
});

function log(message) {
  console.log(message);
  postMessage(message);
}

if (hostname.includes(":")) {
  log(`ws://[${hostname}]:${port}/bun:inspect`);
} else {
  log(`ws://${hostname}:${port}/bun:inspect`);
}
