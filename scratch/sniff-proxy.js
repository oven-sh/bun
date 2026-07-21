// TCP sniffer proxy: prints per-connection server->client TLS records (+hex tail)
const net = require("node:net");
const target = parseInt(process.argv[2], 10);
let connNo = 0;
const proxy = net.createServer(cs => {
  const id = ++connNo;
  const chunks = [];
  const up = net.connect(target, "127.0.0.1");
  cs.pipe(up);
  up.on("data", d => { chunks.push(d); cs.write(d); });
  up.on("end", () => cs.end());
  up.on("error", () => cs.destroy());
  cs.on("error", () => up.destroy());
  cs.on("close", () => {
    const all = Buffer.concat(chunks);
    const recs = [];
    let off = 0;
    while (off + 5 <= all.length) {
      const t = all[off], len = all.readUInt16BE(off + 3);
      const complete = off + 5 + len <= all.length;
      recs.push(`${t}[${len}]${complete ? "" : "!TRUNC"}`);
      off += 5 + len;
    }
    const trailing = all.length - off;
    console.log(`conn ${id}: total=${all.length} records=${recs.join(" ")}${trailing ? ` TRAILING ${trailing} bytes: ${all.slice(off).toString("hex")}` : ""}`);
    console.log(`conn ${id} tail hex: ${all.slice(Math.max(0, all.length - 48)).toString("hex")}`);
  });
});
proxy.listen(0, "127.0.0.1", () => console.log("PROXYPORT=" + proxy.address().port));
