import { open } from "node:fs/promises";
let kept;
{ await using handle = await open("/etc/hostname"); kept = handle; console.log((await handle.readFile("utf8")).length > 0, handle.fd > 0); }
console.log(kept.fd);
