// A slow async consumer of a fast 400 MB producer: does backpressure hold (bounded readableLength and RSS)?
const { spawn } = require("child_process");
(async () => {
  const c = spawn("head", ["-c", "400000000", "/dev/zero"], { stdio: ["ignore", "pipe", "ignore"] });
  let bytes = 0, chunks = 0, maxBuffered = 0, maxChunk = 0;
  const how = process.argv[2] || "forawait";
  if (how === "forawait") {
    for await (const chunk of c.stdout) { bytes += chunk.length; chunks++; maxChunk = Math.max(maxChunk, chunk.length); maxBuffered = Math.max(maxBuffered, c.stdout.readableLength); if (chunks % 64 === 0) await new Promise(r => setTimeout(r, 1)); }
  } else {
    await new Promise(resolve => {
      c.stdout.on("data", chunk => { bytes += chunk.length; chunks++; maxChunk = Math.max(maxChunk, chunk.length); c.stdout.pause(); setTimeout(() => { maxBuffered = Math.max(maxBuffered, c.stdout.readableLength); c.stdout.resume(); }, 0); });
      c.stdout.on("end", resolve);
    });
  }
  console.log(how, JSON.stringify({ bytes, chunks, maxChunk, maxBuffered, rss_mb: Math.round(process.memoryUsage().rss / 1048576) }));
})();
