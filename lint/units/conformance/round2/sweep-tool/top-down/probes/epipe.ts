let n = 0;
for (let i = 0; i < 200000; i++) { console.log("line " + i); n++; }
await Bun.write("/tmp/st1b/epipe.out", `wrote ${n} lines, exiting normally\n`);
