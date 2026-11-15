// What the wait right behind fetch() and text() gives is what their rows say: a text is printed, and no printer comes.
// STATISTIC: ImageFunctionsEmitted <= 40
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    return new Response(request.url.slice(-8));
  },
});
console.log(await (await fetch(`http://127.0.0.1:${server.port}/made-up`)).text());
server.stop(true);
