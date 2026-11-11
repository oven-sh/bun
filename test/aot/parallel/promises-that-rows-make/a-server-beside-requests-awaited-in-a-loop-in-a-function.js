// The same in a function of the program, in a loop.
// STATISTIC: ImageFunctionsEmitted <= 40
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    return new Response(request.url.slice(-2));
  },
});
async function ask(path) {
  const answer = await fetch(`http://127.0.0.1:${server.port}/${path}`);
  return await answer.text();
}
for (const path of ["a1", "b2", "c3"]) console.log(await ask(path));
server.stop(true);
