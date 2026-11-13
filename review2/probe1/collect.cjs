// execFile collecting SIZE bytes with maxBuffer Infinity (chunks are retained until 'close').
const { execFile } = require("node:child_process");
const SIZE = +process.env.SIZE || 256 * 1024 * 1024;
execFile("sh", ["-c", `head -c ${SIZE} /dev/zero`], { maxBuffer: Infinity, encoding: "buffer" }, (err, stdout) => {
  console.log(JSON.stringify({ err: err && err.message, bytes: stdout.length, rssMB: Math.round(process.memoryUsage().rss / 1048576) }));
});
