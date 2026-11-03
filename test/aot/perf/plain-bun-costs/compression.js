const zlib = require("node:zlib");
let text = ""; for (let i = 0; i < 5000; i++) text += "line " + (i * 2654435761 % 1000) + " of some text that repeats\n";
const data = Buffer.from(text), small = data.subarray(0, 600);
let sum = 0;
for (let i = 0; i < 12; i++) { sum += zlib.gunzipSync(zlib.gzipSync(data)).length + zlib.inflateSync(zlib.deflateSync(data)).length + zlib.inflateRawSync(zlib.deflateRawSync(data, { level: 1 })).length; }
for (let i = 0; i < 1000; i++) sum += zlib.gunzipSync(zlib.gzipSync(small)).length;
for (let i = 0; i < 75; i++) sum += zlib.brotliDecompressSync(zlib.brotliCompressSync(small, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } })).length;
for (let i = 0; i < 12; i++) sum += Bun.gunzipSync(Bun.gzipSync(data)).length + Bun.inflateSync(Bun.deflateSync(data)).length;
for (let i = 0; i < 12; i++) sum += Bun.zstdDecompressSync(Bun.zstdCompressSync(data)).length;
sum += zlib.crc32(data);
(async () => {
  for (let i = 0; i < 50; i++) sum += (await new Promise((resolve, reject) => zlib.gzip(small, (e, r) => (e ? reject(e) : resolve(r))))).length;
  for (let i = 0; i < 20; i++) {
    const gz = zlib.createGzip(), chunks = [];
    gz.on("data", c => chunks.push(c));
    const done = new Promise(r => gz.on("end", r));
    for (let k = 0; k < data.length; k += 16384) gz.write(data.subarray(k, k + 16384));
    gz.end(); await done; sum += Buffer.concat(chunks).length;
  }
  console.log("zlib", sum);
})();
