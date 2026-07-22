// Does Bun.serve accept node's inspector-helper upgrade request verbatim?
// (helper sends Sec-WebSocket-Key: 'key==' , which is not 16 bytes of base64)
import { spawn } from "child_process";
import http from "http";

const BUN = process.argv[2];
const child = spawn(BUN, ["scratch/sim_child.js"], { stdio: ["ignore", "pipe", "pipe"] });
let sbuf = "", started = false;
child.stderr.on("data", d => {
  sbuf += d;
  const m = sbuf.match(/Debugger listening on (ws:\/\/\S+)/);
  if (m && !started) { started = true; go(m[1]); }
});
async function go(url) {
  const u = new URL(url);
  const list = await (await fetch(`http://${u.host}/json/list`)).json();
  const dev = new URL(list[0].webSocketDebuggerUrl);
  const req = http.get({
    port: u.port, family: 4, path: dev.pathname,
    headers: {
      "Connection": "Upgrade", "Upgrade": "websocket",
      "Sec-WebSocket-Version": 13, "Sec-WebSocket-Key": "AAAAAAAAAAAAAAAAAAAAAA==",
    },
  });
  req.on("upgrade", (msg, socket) => { console.log("UPGRADE ok, status", msg.statusCode); socket.destroy(); finish(); });
  req.on("response", res => { console.log("RESPONSE (no upgrade), status", res.statusCode); res.resume(); finish(); });
  req.on("error", e => { console.log("ERR", e.message); finish(); });
}
function finish() { child.kill(); process.exit(0); }
setTimeout(() => { console.log("TIMEOUT"); finish(); }, 8000);
