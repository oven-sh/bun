// Test cancellation
const cancelReasons = [];

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const stream = new ReadableStream({
      type: 'direct',
      async pull(controller) {
        controller.write('Start');
        await Bun.sleep(100); // Keep stream open
      },
      cancel(reason) {
        cancelReasons.push(reason);
        console.log('Cancel called with reason:', reason);
      },
    });

    return new Response(stream, {
      headers: { 'Content-Type': 'text/plain' },
    });
  },
});

console.log(`Server running on port ${server.port}`);

// Make a request and abort it
const controller = new AbortController();
const fetchPromise = fetch(`http://localhost:${server.port}/`, { signal: controller.signal });

await Bun.sleep(50);
console.log("Aborting request");
controller.abort();

try {
  await fetchPromise;
} catch (e) {
  console.log("Fetch aborted as expected");
}

await Bun.sleep(100);
console.log("Cancel reasons received:", cancelReasons.length);
console.log("Cancel reasons:", cancelReasons);

server.stop();