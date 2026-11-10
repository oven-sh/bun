// The same for ok, status and the length of the bytes.
// STATISTIC: ImageFunctionsEmitted <= 40
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch() {
    return new Response("made up", { status: 201 });
  },
});
const answer = await fetch(`http://127.0.0.1:${server.port}/made-up`);
console.log(answer.ok, answer.status, (await answer.bytes()).length);
server.stop(true);
