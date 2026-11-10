// The host prints an answer that is no Response, and runs every getter of native code above it. The port stands in what is printed: a run that ends with a code of its own is held by the first line of that.
// Exit code: 3
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request, self) {
    setImmediate(() => {
      console.log("alive");
      process.exit(3);
    });
    return self;
  },
});
Bun.spawnSync(["bash", "-c", `exec 3<>/dev/tcp/127.0.0.1/${server.port}; printf 'GET /made-up HTTP/1.0\\r\\n\\r\\n' >&3`]);
