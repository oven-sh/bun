console.log(JSON.stringify({ sum: Bun.zstdCompressSync("aaaa") }, ["sum", "type"]));
