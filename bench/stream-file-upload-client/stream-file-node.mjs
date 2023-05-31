import { createReadStream } from "node:fs";
import http from "node:http";

console.time("stream-file-node");
createReadStream(process.env.FILE ?? "hello.txt")
  .pipe(
    http.request(process.env.URL ?? "http://localhost:3000", {
      method: "POST",
    }),
  )
  .on("body", body => {
    console.log("Sent", parseInt(body.toString(), 10), "bytes");
  })
  .on("close", () => {
    console.timeEnd("stream-file-node");
  });
