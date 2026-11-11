// The promise of an async handler settles with what `then` hands on, and the host prints that.
// Exit code: 3
let kept;
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  development: false,
  fetch: async () => {
    const answer = new Response("never");
    Reflect.setPrototypeOf(answer, { then: resolve => resolve(kept) });
    return answer;
  },
});
kept = server;
const response = await fetch(`http://127.0.0.1:${server.port}/made-up`);
console.log(`SAID ${response.status}`);
process.exit(3);
