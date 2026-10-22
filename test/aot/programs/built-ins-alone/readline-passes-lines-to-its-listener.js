import { createInterface } from "node:readline";
import { Readable } from "node:stream";
const reader = createInterface({ input: Readable.from(["first\nsecond\n"]) });
reader.on("line", line => console.log(typeof line, line.length, line));
reader.on("close", () => console.log("closed"));
