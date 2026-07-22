// Attach a CDP-speaking client to a `bun --inspect-brk` child and log the wire.
import { spawn } from "child_process";

const BUN = process.argv[2];
const target = process.argv[3];

const child = spawn(BUN, ["--inspect-brk=0", target], { stdio: ["ignore", "pipe", "pipe"] });
child.stdout.on("data", d => process.stdout.write("[out] " + d));

let url = null;
let buf = "";
child.stderr.on("data", d => {
  buf += d;
  process.stdout.write("[err] " + String(d).replace(/\x1b\[[0-9;]*m/g, ""));
  const m = buf.replace(/\x1b\[[0-9;]*m/g, "").match(/(ws:\/\/[^\s\x1b]+)/);
  if (m && !url) {
    url = m[1];
    setTimeout(() => go(url), 100);
  }
});

async function httpTry(base, path) {
  try {
    const r = await fetch(base + path);
    console.log(`[http] ${path} -> ${r.status} ${(await r.text()).slice(0, 200)}`);
  } catch (e) {
    console.log(`[http] ${path} -> ERR ${e.message}`);
  }
}

async function go(url) {
  const u = new URL(url);
  const base = `http://${u.host}`;
  await httpTry(base, "/json/list");
  await httpTry(base, "/json/version");

  const ws = new WebSocket(url);
  let id = 0;
  const send = (method, params) => {
    const msg = JSON.stringify({ id: ++id, method, params: params ?? {} });
    console.log("[send]", msg);
    ws.send(msg);
  };
  ws.onopen = () => {
    console.log("[ws] open");
    send("NodeRuntime.enable");
    send("Runtime.enable");
    send("Debugger.enable");
    setTimeout(() => send("Runtime.runIfWaitingForDebugger"), 500);
  };
  ws.onmessage = e => console.log("[recv]", String(e.data).slice(0, 300));
  ws.onerror = e => console.log("[ws] error", e.message ?? e);
  ws.onclose = e => console.log("[ws] close", e.code, e.reason);
}

setTimeout(() => {
  console.log("[probe] done, killing child");
  child.kill();
  process.exit(0);
}, 6000);
