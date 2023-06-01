import { file } from "bun";
console.time("stream-file-bun");
const response = await fetch(process.env.URL ?? "http://localhost:3000", {
  method: "POST",
  body: file(process.env.FILE ?? "hello.txt"),
});
console.timeEnd("stream-file-bun");

console.log("Sent", await response.text(), "bytes");
