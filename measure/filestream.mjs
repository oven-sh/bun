let n = 0, bytes = 0;
for await (const chunk of Bun.file(new URL("./big.bin", import.meta.url)).stream()) { n++; bytes += chunk.length; }
console.log(JSON.stringify({ n, bytes }));
