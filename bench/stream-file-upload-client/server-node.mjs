import { createServer } from "node:http";
const server = createServer((req, res) => {
  var chunkSize = 0;
  req.on("data", chunk => {
    chunkSize += chunk.byteLength;
  });

  req.on("end", () => {
    console.log("Received", chunkSize, "bytes");
    res.end(`${chunkSize}`);
  });
});
server.listen(parseInt(process.env.PORT ?? "3000"), (err, port) => {
  console.log(`http://localhost:${server.address().port}`);
});
