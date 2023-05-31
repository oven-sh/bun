import { file } from "bun";
console.time("stream-file-bun");
await fetch(process.env.URL ?? "http://localhost:3000", {
  method: "POST",
  body: file(process.env.FILE ?? "hello.txt"),
});
console.timeEnd("stream-file-bun");
