import { Storage } from "@google-cloud/storage";
import http from "node:http";
import { listen, readBody } from "./lib_http.ts";

const seen: string[] = [];
const server = http.createServer(async (request, response) => {
  await readBody(request);
  seen.push(`${request.method} ${request.url!.split("?")[0]}`);
  if (request.url!.includes("alt=media")) response.end("hello object");
  else { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ kind: "storage#objects", items: [{ name: "one.txt", bucket: "b", size: "3" }, { name: "two.txt", bucket: "b", size: "5" }] })); }
});
const port = await listen(server);
const storage = new Storage({ apiEndpoint: `http://127.0.0.1:${port}`, projectId: "p", useAuthWithCustomEndpoint: false, retryOptions: { autoRetry: false } });
const [files] = await storage.bucket("b").getFiles();
console.log(files.map(file => file.name + " " + file.metadata.size).join());
const [content] = await storage.bucket("b").file("one.txt").download({ validation: false });
console.log(content.toString());
server.close();
console.log(seen.join(" | "));
console.log("DONE");
process.exit(0);
