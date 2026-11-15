import "node:path"; console.log(JSON.stringify(Bun.zstdCompressSync("aaaa")).slice(0, 24));
