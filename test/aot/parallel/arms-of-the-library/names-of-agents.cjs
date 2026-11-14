"use strict";
// agent.getName() of every mixture of options, asked again and again, and what it reads of them.
const http = require("node:http"), https = require("node:https");
const say = (...parts) => console.log("#", ...parts);
const parts = { host: ["a", "b", "", undefined, null, 5, new String("a"), { toString() { seen.push("host"); return "h"; } }], port: [80, "80", 81, 0, -0, NaN, "", undefined, null, true, 5n, { toString() { seen.push("port"); return "9"; } }, [7]], localAddress: [undefined, "127.0.0.1", "", 0], family: [undefined, 4, 6, "4", 0], socketPath: [undefined, "/s", ""] };
const seen = [];
for (const agent of [http.globalAgent, new http.Agent(), new https.Agent()]) {
  for (let turn = 0; turn < 2; turn++) {
    const out = [];
    for (const host of parts.host) for (const port of parts.port) for (const localAddress of parts.localAddress) for (const family of parts.family) for (const socketPath of parts.socketPath) {
      let name; try { name = agent.getName({ host, port, localAddress, family, socketPath }); } catch (error) { name = error.name; }
      out.push(name);
      for (let again = 0; again < 2; again++) { let more; try { more = agent.getName({ host, port, localAddress, family, socketPath }); } catch (error) { more = error.name; } if (more !== name) out.push("OTHER " + more); }
    }
    say(out.length, seen.length, require("node:crypto").createHash("sha1").update(out.join("\n")).digest("hex"), out[7], out[900], out.at(-1), out.map(name => typeof name).filter((type, index, all) => all.indexOf(type) === index).join());
  }
  say(agent.getName(), agent.getName({}));
  const log = []; const proxy = new Proxy({ host: "a", port: 80 }, { get(it, key) { log.push(String(key)); return it[key]; } });
  for (let turn = 0; turn < 3; turn++) agent.getName(proxy);
  say(log.join());
}
class Named extends http.Agent { getName(options) { return "named " + super.getName(options); } }
say(new Named().getName({ host: "a", port: 80 }), http.globalAgent.getName({ host: "a", port: 80 }));
