const http = require("node:http");

const server = http.createServer((req, res) => {
  // Set response headers
  res.setHeader("Content-Type", "text/plain");
  res.setHeader("X-Powered-By", "Node.js");
  res.setHeader("Cache-Control", ["no-cache", "yes-cache"]);
  res.appendHeader("Cache-Control", "maybe-cache");
  res.appendHeader("Cache-Control", ["please-cache", "please-dont-cache"]);
  res.setHeader("Set-Cookie", ["a=b", "c=d"]);
  res.appendHeader("Set-Cookie", "e=f");
  res.appendHeader("Set-Cookie", ["g=h", "i=j"]);
  res.setHeader("Abc", ["list-one", "list-two"]);
  res.setHeader("Abc", ["list-three", "list-four"]);

  // Write response
  res.statusCode = 200;
  res.end("Hello World\n");
});

const PORT = 0;
server.listen(PORT, async () => {
  const port = server.address().port;
  console.log(`Server running`);

  // Test the server response headers using fetch
  try {
    const response = await fetch(`http://localhost:${port}/`);
    console.log("Response status: " + response.status);

    // Check headers
    console.log("Headers test results:");
    response.headers.delete("date");
    for (const [key, value] of response.headers.entries()) {
      console.log(`${key}: ${value}`);
    }

    const body = await response.text();
    console.log("Body:", body);
    process.exit(0);
  } catch (error) {
    console.error("Error testing server:", error);
    process.exit(1);
  } finally {
    // Uncomment to close server after test
    // server.close();
  }
});
