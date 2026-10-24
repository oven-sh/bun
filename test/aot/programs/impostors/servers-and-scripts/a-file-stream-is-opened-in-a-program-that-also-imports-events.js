import { EventEmitter } from "node:events";
import fs from "node:fs";

fs.createReadStream(process.execPath, { end: 3 })
  .on("error", error => console.log("failed", error.message))
  .on("open", fd => console.log("opened", typeof fd, typeof EventEmitter))
  .resume();
