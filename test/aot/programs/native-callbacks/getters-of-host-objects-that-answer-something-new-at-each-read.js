// Getters of host objects that make their answer anew at each read.
import { BlockList } from "node:net";
function twice(read) { const a = read(), b = read(); return [a === b, JSON.stringify(a) === JSON.stringify(b)]; }
const list = new BlockList();
list.addAddress("1.2.3.4");
function rulesTwice(o) { const a = o.rules, b = o.rules; a.push("mine"); return [a === b, a.length, b.length, o.rules.length]; }
console.log("rules", rulesTwice(list), twice(() => list.rules));
const before = list.rules;
list.addAddress("5.6.7.8");
console.log("rules", before.length, list.rules.length, before === list.rules);

new HTMLRewriter().on("p", { element(e) { const a = e.attributes, b = e.attributes; console.log("attributes", a === b, [...a].join(), [...b].join(), [...e.attributes].join()); e.setAttribute("c", "3"); console.log("attributes", [...e.attributes].join()); } }).transform("<p a=1 b=2></p>");

const child = Bun.spawn([process.execPath, "--version"], { stdout: "pipe", stderr: "ignore", stdin: "ignore", env: { BUN_BE_BUN: "1" } });
function stdioTwice(c) { const a = c.stdio, b = c.stdio; a.push("mine"); return [a === b, a.length, b.length, c.stdio.length]; }
console.log("stdio", stdioTwice(child));
await child.exited;
const usage = child.resourceUsage();
function messagesTwice(u) { const a = u.messages, b = u.messages; a.mine = 1; return [a === b, Object.keys(a).join(), Object.keys(b).join(), Object.keys(u.messages).join()]; }
console.log("messages", messagesTwice(usage));

let done;
const finished = new Promise(resolve => { done = resolve; });
const server = Bun.serve({
  port: 0,
  fetch(request, server) { return server.upgrade(request) ? undefined : new Response("no"); },
  websocket: {
    open(socket) {
      socket.subscribe("one");
      const a = socket.subscriptions, b = socket.subscriptions;
      a.push("mine");
      console.log("subscriptions", a === b, a.length, b.length, socket.subscriptions.length);
      socket.subscribe("two");
      console.log("subscriptions", b.length, socket.subscriptions.length);
      socket.close();
    },
    message() {},
    close() { done(); },
  },
});
const client = new WebSocket(`ws://localhost:${server.port}/`);
await finished;
client.close();
server.stop(true);
