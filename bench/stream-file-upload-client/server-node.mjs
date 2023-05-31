import { createServer } from "node:http";
const server = createServer((req, res) => {
  var chunkSize = 0;
  req.on("data", (chunk) => {
    chunkSize += chunk.byteLength;
  });

  req.on("end", () => {
    console.log("Received", chunkSize, "bytes");
    res.end(`${chunkSize}`);
  });
});
server.listen(0, (err, port) => {
  console.log(`http://localhost:${server.address().port}`);
});

