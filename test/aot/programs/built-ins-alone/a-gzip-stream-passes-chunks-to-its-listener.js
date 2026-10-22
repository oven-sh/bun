import zlib from "node:zlib";
const chunks = [];
const stream = zlib.createGzip();
stream.on("data", chunk => chunks.push(chunk));
stream.on("end", () => console.log(zlib.gunzipSync(Buffer.concat(chunks)).toString()));
stream.end("hello");
