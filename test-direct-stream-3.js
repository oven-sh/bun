// Test with async pull
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    console.log("Creating direct stream with async pull");
    const stream = new ReadableStream({
      type: 'direct',
      async pull(controller) {
        console.log("Pull called, sleeping...");
        await Bun.sleep(10);
        console.log("Writing 'Hello'");
        controller.write('Hello');
        console.log("Closing controller");
        controller.close();
      },
      cancel(reason) {
        console.log('Cancel called with reason:', reason);
      },
    });

    console.log("Returning Response with stream");
    return new Response(stream, {
      headers: { 'Content-Type': 'text/plain' },
    });
  },
});

console.log(`Server running on port ${server.port}`);

// Make a request
const response = await fetch(`http://localhost:${server.port}/`);
console.log("Got response");
const text = await response.text();
console.log("Got text:", JSON.stringify(text));

server.stop();