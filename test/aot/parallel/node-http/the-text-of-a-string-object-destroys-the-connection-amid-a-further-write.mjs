import http from "node:http";
const said = [];
const server = http.createServer((req, res) => {
  let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0;
  res.on("error", e => said.push("error " + e.code));
  said.push("first " + res.write(JSON.parse('"aa"')));
  const text = new String(JSON.parse('"cc"'));
  text.toString = () => { said.push("amid"); res.socket.destroy(); return "cc"; };
  try { const r = res.write(text); said.push("call " + (r === res ? "res" : String(r))); } catch (e) { said.push("call " + e.name + " " + e.code); }
  said.push("finished " + res.finished + " destroyed " + res.destroyed);
  if (!res.finished && !res.destroyed) try { res.end("!"); } catch (e) { said.push("end " + e.name + " " + e.code); }
});
server.listen(0, async () => {
  let answer = "no answer";
  try {
    const r = await fetch("http://127.0.0.1:" + server.address().port + "/");
    answer = r.status + " " + JSON.stringify(await r.text()) + " " + [...r.headers].filter(([n]) => n !== "date").map(([n, v]) => n + "=" + v).sort().join(",");
  } catch {}
  console.log("SAID " + said.join(" | ") + " | " + answer);
  server.close();
  server.closeAllConnections();
});
