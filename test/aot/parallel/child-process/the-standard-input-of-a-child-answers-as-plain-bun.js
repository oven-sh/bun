// The standard input of a child of node:child_process: what it is when spawn() returns, what a child that reads gets, and the events and callbacks of eighteen orders of calls, in the tick of spawn() and one macrotask later.
const { spawn } = require("node:child_process");
const { stdinCallOrders } = require("../../../js/node/child_process/fixtures/stdin-call-orders-fixture.js");

const child = spawn("cat", [], { stdio: ["pipe", "pipe", "inherit"] });
const stdin = child.stdin;
const atBirth = {
  constructed: stdin._writableState.constructed,
  pending: stdin.pending,
  own: Object.keys(child).filter(key => key.startsWith("std")),
};
let read = "";
child.stdout.setEncoding("utf8").on("data", chunk => (read += chunk));
stdin.write("a");
stdin.write("b");
stdin.end("c");
child.on("close", () => {
  // The fixture starts from a macrotask, as the main script of a program does.
  setImmediate(async () => {
    const inTheTick = await stdinCallOrders(false);
    const later = await stdinCallOrders(true);
    console.log(JSON.stringify({ atBirth, read, inTheTick, later }, null, 1));
  });
});
