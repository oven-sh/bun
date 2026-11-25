// The host makes a FormData and nothing else for the promise of formData().
// STATISTIC: ImageFunctionsEmitted <= 100
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const form = await request.formData();
    console.log(`${form.get("a")} ${form.get("b")} ${form.has("c")}`);
    process.exit(0);
  },
});
Bun.spawnSync([
  "bash",
  "-c",
  `exec 3<>/dev/tcp/127.0.0.1/${server.port}; printf 'POST /made-up HTTP/1.0\\r\\nContent-Type: application/x-www-form-urlencoded\\r\\nContent-Length: 7\\r\\n\\r\\na=1&b=2' >&3`,
]);
