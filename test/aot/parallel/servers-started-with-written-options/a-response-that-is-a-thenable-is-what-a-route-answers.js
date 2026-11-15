// The same below `routes`.
// Exit code: 3
let kept;
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  development: false,
  routes: {
    "/made-up": async () => {
      const answer = new Response("never");
      answer.then = resolve => resolve(kept);
      return answer;
    },
  },
});
kept = server;
const response = await fetch(`http://127.0.0.1:${server.port}/made-up`);
console.log(`SAID ${response.status}`);
process.exit(3);
