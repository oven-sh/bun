const http = require("node:http");

const server = http.createServer((req, res) => {
  console.log("Request received");

  // Don't use writeHead - let flushHeaders do it via _implicitHeader
  res.flushHeaders();
  console.log("flushHeaders called");

  setTimeout(() => {
    console.log("Sending body after delay");
    res.write("Hello ");
    res.end("World");
  }, 1000);
});

server.listen(0, () => {
  const port = server.address().port;
  console.log(`Server listening on port ${port}`);

  const startTime = Date.now();

  const req = http.get(`http://localhost:${port}`, res => {
    const headersReceivedTime = Date.now() - startTime;
    console.log(`Headers received after ${headersReceivedTime}ms`);

    let body = "";
    res.on("data", chunk => {
      body += chunk;
    });

    res.on("end", () => {
      console.log(`Body: "${body}"`);

      if (headersReceivedTime < 500) {
        console.log("✓ PASS: Headers were flushed immediately");
      } else {
        console.log("✗ FAIL: Headers were not flushed");
      }

      server.close();
    });
  });
});
