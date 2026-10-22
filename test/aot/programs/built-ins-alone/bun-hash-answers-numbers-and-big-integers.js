console.log(typeof Bun.hash("text"), typeof Bun.hash.crc32("text"), Bun.hash.crc32("text") + 1, typeof Bun.hash.wyhash("text"));
