
// debugger;

Bun.serve({
  fetch(req) {
    console.log("test")
    return new Response('Hello, world!');
  }
});
