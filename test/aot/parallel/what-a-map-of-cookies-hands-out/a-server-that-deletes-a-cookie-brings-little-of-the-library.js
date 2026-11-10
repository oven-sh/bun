// delete() reads three members of its options and describes no value: it brings nothing that prints.
// STATISTIC: ImageFunctionsEmitted <= 100
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  routes: {
    "/made-up": request => {
      request.cookies.delete("a");
      request.cookies.delete("b", { path: "/made" });
      console.log(`${request.cookies.has("a")} ${request.cookies.get("c")} ${request.cookies.size}`);
      process.exit(0);
    },
  },
});
Bun.spawnSync([
  "bash",
  "-c",
  `exec 3<>/dev/tcp/127.0.0.1/${server.port}; printf 'GET /made-up HTTP/1.0\\r\\nCookie: a=1; c=3\\r\\n\\r\\n' >&3`,
]);
