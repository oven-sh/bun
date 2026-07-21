const net = require("node:net");
const target = parseInt(process.argv[2], 10);
let connNo = 0;
function recs(all) {
  const out = []; let off = 0;
  while (off + 5 <= all.length) {
    const t = all[off], len = all.readUInt16BE(off + 3);
    if (off + 5 + len > all.length) { out.push(`${t}[${len}]!PART`); break; }
    out.push(`${t}[${len}]`); off += 5 + len;
  }
  return out.join(" ");
}
const proxy = net.createServer(cs => {
  const id = ++connNo;
  const chunks = [];
  const t0 = Date.now();
  const up = net.connect(target, "127.0.0.1");
  cs.pipe(up);
  up.on("data", d => { chunks.push(d); cs.write(d); });
  const log = ev => console.log(`conn ${id} +${Date.now() - t0}ms ${ev}: S->C ${recs(Buffer.concat(chunks))}`);
  up.on("end", () => { log("SERVER_FIN"); cs.end(); });
  up.on("error", e => { log("SERVER_ERR " + e.code); cs.destroy(); });
  up.on("close", () => log("SERVER_CLOSE"));
  cs.on("end", () => log("CLIENT_FIN"));
  cs.on("error", () => up.destroy());
  cs.on("close", () => log("CLIENT_CLOSE"));
});
proxy.listen(0, "127.0.0.1", () => console.log("PROXYPORT=" + proxy.address().port));
