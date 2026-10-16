// Common idioms that take the 'error' of a stream once. stdout is a pipe whose reader reads one byte and exits.
const mode = process.argv[2];
const fs = require("node:fs");
const { once } = require("node:events");
const big = Buffer.alloc((1 << 20) + 1, "a");
const out = process.stdout;
(async () => {
  try {
    if (mode === "events.once-finish") {
      out.write(big);
      out.end();
      await once(out, "finish");
    } else if (mode === "promise-wrapper-end-chunk") {
      out.write(big);
      await new Promise((resolve, reject) => {
        out.once("error", reject);
        out.end("bye\n", resolve);
      });
    } else if (mode === "promise-wrapper-finish") {
      await new Promise((resolve, reject) => {
        out.once("error", reject);
        out.once("finish", resolve);
        out.write(big);
        out.end();
      });
    } else if (mode === "no-listener") {
      out.write(big);
      out.end();
      await new Promise(r => setTimeout(r, 300));
    } else if (mode === "write-only-once") {
      // reference: no end(), callback-less write only
      await new Promise((resolve, reject) => {
        out.once("error", reject);
        out.write(big);
        setTimeout(resolve, 300);
      });
    }
    fs.writeSync(2, "completed without an error\n");
  } catch (e) {
    fs.writeSync(2, "caught: " + (e.code ?? e.message) + "\n");
  }
  await new Promise(r => setTimeout(r, 300));
  fs.writeSync(2, "program reached its end\n");
})();
