const bytes = Bun.gunzipSync(Bun.gzipSync("hello"));
console.log(bytes instanceof Uint8Array, bytes.length + 1, bytes[0] + 1);
