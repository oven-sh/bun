// Test with synchronous pull but delayed close
const server = Bun.serve({
  port: 0,
  fetch(request) {
    console.log("Creating direct stream");
    const stream = new ReadableStream({
      type: 'direct',
      pull(controller) {
        console.log("Pull called, writing 'Hello'");
        controller.write('Hello');
        console.log("Setting timeout to close");
        setTimeout(() => {
          console.log("Closing controller");
          controller.close();
        }, 0);
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