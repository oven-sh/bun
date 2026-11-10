import { open } from "node:fs/promises";
const handle = await open("/etc/hostname");
const stream = handle.createReadStream({ encoding: "utf8" }); let text = ""; for await (const chunk of stream) text += chunk;
console.log(text.length > 0, handle.fd);
