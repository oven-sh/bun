// atob() throws an object that native code made, of a class that the program does not name, and `error` is handed it.
// STATISTIC: ImageFunctionsEmitted <= 30
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch() {
    atob("*");
  },
  error(error) {
    console.log(`${error.name} ${error.code}`, error instanceof Error);
    process.exit(0);
  },
});
Bun.spawnSync(["bash", "-c", `exec 3<>/dev/tcp/127.0.0.1/${server.port}; printf 'GET /made-up HTTP/1.0\\r\\n\\r\\n' >&3`]);
