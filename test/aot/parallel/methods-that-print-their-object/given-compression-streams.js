// Alone: what it prints depends on what else the executable holds: whether the printer of node:util was compiled in
console.log(new CompressionStream("gzip"));
console.log(new DecompressionStream("gzip").writable);
