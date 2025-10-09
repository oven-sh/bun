const http = require("node:http");
const net = require("node:net");

// Use a raw TCP socket to see when bytes actually arrive
const server = http.createServer((req, res) => {
  console.log("Request received");
  res.writeHead(200, { "Content-Type": "text/plain" });
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
  let headersReceivedTime = null;

  const client = net.connect(port, () => {
    client.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
  });

  let receivedData = "";
  client.on("data", data => {
    const now = Date.now() - startTime;
    receivedData += data.toString();

    if (!headersReceivedTime && receivedData.includes("\r\n\r\n")) {
      headersReceivedTime = now;
      console.log(`Headers received after ${headersReceivedTime}ms`);
    }
  });

  client.on("end", () => {
    console.log(`Connection closed`);
    console.log(`Total data: ${receivedData.length} bytes`);

    if (headersReceivedTime < 500) {
      console.log("✓ PASS: Headers were flushed immediately");
    } else {
      console.log("✗ FAIL: Headers were not flushed");
    }

    server.close();
  });
});
