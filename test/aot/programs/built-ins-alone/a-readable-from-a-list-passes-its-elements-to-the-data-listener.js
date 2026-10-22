import { Readable } from "node:stream";
Readable.from([{ size: 1.5 }, "two"]).on("data", chunk => console.log(typeof chunk, chunk));
