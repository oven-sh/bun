console.log(JSON.stringify(Bun.zstdCompressSync("aaaa"), (key, value) => value).slice(0, 24));
