// Drive the node inspector-helper protocol sequence against a bun child that
// waits for a debugger via inspector.open(0, host, true).
import { spawn } from "child_process";

const BUN = process.argv[2];
const child = spawn(BUN, ["scratch/sim_child.js"], { stdio: ["ignore", "pipe", "pipe"] });
child.stdout.on("data", d => process.stdout.write("[out] " + d));

let started = false, sbuf = "";
child.stderr.on("data", d => {
  sbuf += d;
  process.stdout.write("[err] " + d);
  const m = sbuf.match(/Debugger listening on (ws:\/\/\S+)/);
  if (m && !started) { started = true; setTimeout(() => go(m[1]), 50); }
});

async function go(url) {
  const u = new URL(url);
  const list = await (await fetch(`http://${u.host}/json/list`)).json();
  console.log("[http] /json/list ->", JSON.stringify(list).slice(0, 160));
  const ws = new WebSocket(list[0].webSocketDebuggerUrl);
  let id = 0;
  const send = (method, params) => {
    const msg = JSON.stringify({ id: ++id, method, params: params ?? {} });
    console.log("[send]", msg);
    ws.send(msg);
  };
  ws.onopen = () => {
    console.log("[ws] open");
    send("NodeRuntime.enable");
    setTimeout(() => {
      send("Runtime.enable");
      send("Debugger.enable");
      send("Runtime.runIfWaitingForDebugger");
      send("NodeRuntime.disable");
    }, 300);
  };
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.method === "Debugger.scriptParsed") return;
    console.log("[recv]", String(e.data).slice(0, 220));
    if (m.method === "Debugger.paused") {
      console.log("[test] PAUSED at", JSON.stringify(m.params.callFrames?.[0]?.location));
      setTimeout(() => send("Debugger.resume"), 100);
    }
  };
  ws.onclose = e => console.log("[ws] close", e.code);
}
child.on("exit", (c, s) => { console.log("[child] exit", c, s); process.exit(0); });
setTimeout(() => { console.log("[sim] timeout"); child.kill(); process.exit(0); }, 8000);
