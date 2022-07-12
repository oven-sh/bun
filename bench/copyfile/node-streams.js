import { createReadStream, createWriteStream } from "node:fs";

const arg = process.argv.slice(2);
createReadStream(arg[0]).pipe(createWriteStream(arg[1]));
