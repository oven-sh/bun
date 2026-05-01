import { createReadStream } from "node:fs";
import http from "node:http";

console.time("stream-file-node");
createReadStream(process.env.FILE ?? "hello.txt")
  .pipe(
    http
      .request(process.env.URL ?? "http://localhost:3000", {
        method: "POST",
      })
      .on("response", response => {
        response.on("data", data => {
          console.log("Sent", parseInt(data.toString(), 10), "bytes");
        });
      }),
  )
  .on("close", () => {
    console.timeEnd("stream-file-node");
  });
